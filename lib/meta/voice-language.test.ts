import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMostlyNonLatin, LiveVoiceClient, NOT_ENGLISH } from "./voice";

const fetchMock = vi.fn<typeof fetch>();
const AUDIO = `data:audio/wav;base64,${Buffer.from("RIFF0000WAVEdata").toString("base64")}`;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function transcribes(transcript: string) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ transcript, turns: [] }), { status: 200 }));
}

describe("isMostlyNonLatin", () => {
  it.each([
    ["confirmed", false],
    ["Café déjà vu", false],
    ["", false],
    ["12345 !!", false],
    ["подтверждаю", true],
    ["确认发货", true],
    ["تأكيد الشحن", true],
    ["ok подтверждаю отгрузку", true],
    ["ship it now 确认", false],
  ])("%j -> %s", (text, expected) => {
    expect(isMostlyNonLatin(text)).toBe(expected);
  });
});

describe("LiveVoiceClient language handling", () => {
  it("passes an English transcript through", async () => {
    transcribes("confirmed");
    const out = await new LiveVoiceClient("test-key-not-real").transcribe({ audio: AUDIO });
    expect(out).toMatchObject({ transcript: "confirmed", source: "live" });
    expect(out.error).toBeUndefined();
  });

  it("marks a mostly non-Latin transcript unusable instead of passing it on", async () => {
    transcribes("подтверждаю, отправляйте");
    const out = await new LiveVoiceClient("test-key-not-real").transcribe({ audio: AUDIO });
    expect(out.transcript).toBe("");
    expect(out.error).toBe(NOT_ENGLISH);
    expect(out.perceptionDetail).toBe("transcript not in English");
  });

  it("sends no invented language parameter", async () => {
    transcribes("confirmed");
    await new LiveVoiceClient("test-key-not-real").transcribe({ audio: AUDIO });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toMatch(/lang/i);
    const request = await ((init?.body as FormData).get("request") as Blob).text();
    expect(JSON.parse(request)).toEqual({ mode: "ENDPOINTING", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
  });
});
