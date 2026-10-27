import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { META_BASE_URL } from "./http";
import { countBoxRecords, getSamClient, LiveSamClient, MockSamClient, parseSamStream } from "./sam";
import { getSparkClient, LiveSparkClient, MockSparkClient, parseSparkResponse } from "./spark";
import { getVoiceClient, LiveVoiceClient, MockVoiceClient, parseVoiceResponse } from "./voice";

// Never call the live API from tests: every fetch is stubbed.
const fetchMock = vi.fn<typeof fetch>();
const FAKE_KEY = "test-key-not-real";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const WAV = "data:audio/wav;base64,UklGRg==";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sse(events: unknown[]): Response {
  const raw = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(raw, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function samEvents(text: string): unknown[] {
  return [
    { type: "response.created" },
    { type: "response.output_text.delta", delta: text.slice(0, 4) },
    { type: "response.output_text.delta", delta: text.slice(4) },
    { type: "response.completed", response: {} },
  ];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("client selection", () => {
  it("uses mocks unless SAFELABS_USE_MOCKS=false and the key is set", () => {
    vi.stubEnv("META_SPARK_API_KEY", FAKE_KEY);
    vi.stubEnv("META_SAM_API_KEY", FAKE_KEY);
    vi.stubEnv("META_VOICE_API_KEY", "");
    vi.stubEnv("SAFELABS_USE_MOCKS", "true");
    expect(getSparkClient().mode).toBe("mock");
    vi.stubEnv("SAFELABS_USE_MOCKS", "");
    expect(getSamClient().mode).toBe("mock");
    vi.stubEnv("SAFELABS_USE_MOCKS", "false");
    expect(getSparkClient().mode).toBe("live");
    expect(getSamClient().mode).toBe("live");
    expect(getVoiceClient().mode).toBe("mock");
  });
});

describe("Spark JSON parsing", () => {
  it("parses choices[0].message.content, including fenced JSON", () => {
    const claim = parseSparkResponse({
      choices: [
        {
          message: {
            content:
              '```json\n{"objects":["red mug","blue notebook"],"proposedAction":"SEAL","rationale":"ok"}\n```',
          },
        },
      ],
    });
    expect(claim).toEqual({
      objects: ["red mug", "blue notebook"],
      proposedAction: "SEAL",
      rationale: "ok",
      source: "live",
    });
  });

  it("rejects missing content or a malformed claim", () => {
    expect(() => parseSparkResponse({ choices: [] })).toThrow(/parse failure/);
    expect(() => parseSparkResponse({ choices: [{ message: { content: "no json" } }] })).toThrow();
    expect(() =>
      parseSparkResponse({ choices: [{ message: { content: '{"objects":"mug","proposedAction":"X"}' } }] }),
    ).toThrow(/objects/);
  });

  it("posts a non-streaming chat completion with Bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ choices: [{ message: { content: '{"objects":["red mug"],"proposedAction":"VERIFY_MUG","rationale":""}' } }] }),
    );
    const claim = await new LiveSparkClient(FAKE_KEY).reason({ orderId: "ORDER-1042", step: "VERIFY_MUG" });
    expect(claim.source).toBe("live");
    expect(claim.objects).toEqual(["red mug"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${META_BASE_URL}/chat/completions`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe("SAM box-record parsing", () => {
  it("1 box record = verified, 0 = not verified", () => {
    expect(parseSamStream(rawOf(samEvents("<|box;12,40,80,90|>"))).boxCount).toBe(1);
    expect(parseSamStream(rawOf(samEvents("no objects found"))).boxCount).toBe(0);
    expect(countBoxRecords("<|box;1|><|box;2|>")).toBe(2);
  });

  it("only counts text up to response.completed", () => {
    const raw = rawOf([...samEvents("none"), { type: "response.output_text.delta", delta: "<|box;late|>" }]);
    const parsed = parseSamStream(raw);
    expect(parsed.completed).toBe(true);
    expect(parsed.boxCount).toBe(0);
  });

  it("uploads the frame, then verifies each concept over SSE", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/files")) return json({ id: "file-123" });
      const concept = JSON.parse(String(init?.body)).input[0].content[0].text;
      return sse(samEvents(concept === "red mug" ? "<|box;10,10,50,50|>" : "nothing"));
    });
    const result = await new LiveSamClient(FAKE_KEY).segment({ frame: PNG, concepts: ["red mug", "blue notebook"] });
    expect(result.source).toBe("live");
    expect(result.detections.map((d) => d.label)).toEqual(["red mug"]);

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0];
    expect(uploadUrl).toBe(`${META_BASE_URL}/files`);
    expect((uploadInit?.body as FormData).get("purpose")).toBe("user_data");
    const [respUrl, respInit] = fetchMock.mock.calls[1];
    expect(respUrl).toBe(`${META_BASE_URL}/responses`);
    expect(new Headers(respInit?.headers).get("Accept")).toBe("text/event-stream");
    const body = JSON.parse(String(respInit?.body));
    expect(body).toMatchObject({ model: "sam-3.1", stream: true, metadata: { mask_encoding: "lossless" } });
    expect(body.input[0].content[1]).toEqual({ type: "input_image", file_id: "file-123" });
  });

  it("treats a stream without response.completed as a parse failure", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/files") ? json({ id: "f" }) : sse([{ type: "response.output_text.delta", delta: "<|box;1|>" }]),
    );
    const result = await new LiveSamClient(FAKE_KEY).segment({ frame: PNG, concepts: ["red mug"] });
    expect(result.source).toBe("mock");
    expect(result.error).toMatch(/response.completed/);
  });
});

describe("Voice transcript parsing", () => {
  it("parses .transcript and .turns", () => {
    const result = parseVoiceResponse({ transcript: "confirmed", turns: [{ text: "confirmed" }] });
    expect(result.transcript).toBe("confirmed");
    expect(result.turns).toEqual([{ text: "confirmed" }]);
    expect(result.source).toBe("live");
    expect(() => parseVoiceResponse({ turns: [] })).toThrow(/transcript/);
  });

  it("posts multipart request + audio parts with a sessionId", async () => {
    fetchMock.mockResolvedValueOnce(json({ transcript: "yes confirmed", turns: [] }));
    const result = await new LiveVoiceClient(FAKE_KEY).transcribe({ audio: WAV });
    expect(result).toMatchObject({ transcript: "yes confirmed", source: "live" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`^${META_BASE_URL}/asr/transcribe\\?sessionId=[0-9a-f-]{36}$`));
    const form = init?.body as FormData;
    const request = JSON.parse(await (form.get("request") as Blob).text());
    expect(request).toEqual({ mode: "ENDPOINTING", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });
});

describe("mock fallback", () => {
  it("falls back on network failure without throwing", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const claim = await new LiveSparkClient(FAKE_KEY).reason({ orderId: "ORDER-1042", step: "SEAL" });
    const expected = await new MockSparkClient().reason({ orderId: "ORDER-1042", step: "SEAL" });
    expect(claim).toEqual({ ...expected, source: "mock", error: "fetch failed" });

    const sam = await new LiveSamClient(FAKE_KEY).segment({ frame: PNG, concepts: ["red mug"] });
    expect(sam).toEqual({
      ...(await new MockSamClient().segment({ frame: PNG, concepts: ["red mug"] })),
      source: "mock",
      error: "fetch failed",
    });

    const voice = await new LiveVoiceClient(FAKE_KEY).transcribe({ audio: WAV, mockTranscript: "confirmed" });
    expect(voice).toEqual({
      ...(await new MockVoiceClient().transcribe({ audio: WAV, mockTranscript: "confirmed" })),
      source: "mock",
      error: "fetch failed",
    });
  });

  it.each([401, 429, 500])("falls back on HTTP %i and never leaks the key", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "nope" }, status));
    const claim = await new LiveSparkClient(FAKE_KEY).reason({ orderId: "ORDER-1042", step: "SEAL" });
    expect(claim.source).toBe("mock");
    expect(claim.error).toBe(`HTTP ${status} from /chat/completions`);
    expect(JSON.stringify(claim)).not.toContain(FAKE_KEY);
  });

  it("falls back on timeout", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    fetchMock.mockRejectedValue(timeout);
    const voice = await new LiveVoiceClient(FAKE_KEY).transcribe({ audio: WAV });
    expect(voice).toMatchObject({ source: "mock", error: "Timed out after 10000ms" });
  });

  it("falls back on unparseable responses and mock:// media", async () => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: "I see a mug" } }] }));
    const claim = await new LiveSparkClient(FAKE_KEY).reason({ orderId: "ORDER-1042", step: "SEAL" });
    expect(claim).toMatchObject({ source: "mock", error: expect.stringMatching(/parse failure/) });

    const sam = await new LiveSamClient(FAKE_KEY).segment({ frame: "mock://asi-mm/A1", concepts: ["red mug"] });
    expect(sam).toMatchObject({ source: "mock", error: expect.stringMatching(/Unsupported media/) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function rawOf(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}
