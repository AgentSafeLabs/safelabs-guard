import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/agent/turn/route";
import { stubLiveEnv, stubMeta, turnRequest, WAV, type Scene } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";

// Every live source failing, one at a time, on /api/agent/turn (non-mock run).
// A failed live call must show as "unavailable" with no data behind it: no mock
// detections, no mock "confirmed" transcript, no invented image text.

const fetchMock = vi.fn<typeof fetch>();
const scene: Scene = { objects: ["red mug"], transcript: "confirmed" };
type Fail = "sam" | "voice" | "vision" | "spark" | null;
let fail: Fail;

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubLiveEnv();
  stubMeta(fetchMock, () => scene);
  const base = fetchMock.getMockImplementation() as typeof fetch;
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const isChat = url.endsWith("/chat/completions");
    const system = isChat ? String(JSON.parse(String(init?.body)).messages[0].content) : "";
    const isVision = system.startsWith("You transcribe text");
    if (fail === "sam" && (url.endsWith("/files") || url.endsWith("/responses"))) return new Response("{}", { status: 500 });
    if (fail === "voice" && url.includes("/asr/transcribe")) return new Response("{}", { status: 500 });
    if (fail === "vision" && isVision) return new Response("{}", { status: 500 });
    if (fail === "spark" && isChat && !isVision) return new Response("{}", { status: 500 });
    return base(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function turn(mode: "guarded" | "unguarded", audio = true) {
  const res = await POST(turnRequest({ mode, audio: audio ? WAV : undefined }));
  return res.json();
}

describe("failed live SAM", () => {
  it.each(["guarded", "unguarded"] as const)("%s: no detections, nothing seen by the agent", async (mode) => {
    fail = "sam";
    const body = await turn(mode);
    expect(body.sources.sam).toBe("unavailable");
    expect(body.perceptionDetail.sam).toMatch(/^sam (error|timeout)$/);
    expect(body.turn.perception.samObjects).toEqual([]);
    if (mode === "guarded") expect(body.turn.perception.agentSaw).toEqual([]);
  });
});

describe("failed live voice", () => {
  it("guarded: BLOCK 'voice unavailable', transcript empty", async () => {
    fail = "voice";
    const body = await turn("guarded");
    expect(body.sources.voice).toBe("unavailable");
    expect(body.turn.guard).toEqual({ decision: "BLOCK", reason: "voice unavailable" });
    expect(body.turn.perception.transcript).toBe("");
    expect(body.turn.observation.transcript).toBe("");
  });

  it("unguarded: the agent is given an empty transcript, not the mock's 'confirmed'", async () => {
    fail = "voice";
    const body = await turn("unguarded");
    expect(body.sources.voice).toBe("unavailable");
    expect(body.turn.perception.transcript).toBe("");
    const sparkCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/chat/completions") &&
        !String(JSON.parse(String(init?.body)).messages[0].content).startsWith("You transcribe text"),
    );
    const facts = JSON.parse(String(JSON.parse(String(sparkCall?.[1]?.body)).messages[1].content));
    expect(facts.untrusted.transcript).toBe("");
  });
});

describe("failed live image text", () => {
  it("guarded: BLOCK 'image text unavailable', no text invented", async () => {
    fail = "vision";
    const body = await turn("guarded", false);
    expect(body.sources.vision).toBe("unavailable");
    expect(body.turn.guard.reason).toMatch(/^image text unavailable/);
    expect(body.turn.perception.imageText).toBe("");
  });
});

describe("failed live Spark", () => {
  it.each(["guarded", "unguarded"] as const)("%s: HOLD, no claim and no proposed action beyond HOLD", async (mode) => {
    fail = "spark";
    const body = await turn(mode, false);
    expect(body.sources.spark).toBe("unavailable");
    expect(body.turn.sparkDecision).toMatchObject({ proposedAction: "HOLD", claimedObjects: [] });
    expect(body.turn.executed).toBeNull();
  });
});

describe("nothing fails: control", () => {
  it("guarded turn ALLOWs with every source live", async () => {
    fail = null;
    const body = await turn("guarded");
    expect(body.sources).toEqual({ sam: "live", voice: "live", vision: "live", spark: "live" });
    expect(body.turn.guard.decision).toBe("ALLOW");
  });
});
