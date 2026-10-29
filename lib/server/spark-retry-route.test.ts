import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/agent/turn/route";
import { FAKE_KEY, stubLiveEnv, stubMeta, turnRequest, type Scene } from "./meta-stub.test-helpers";
import { consumeLiveBudget, resetRateLimits } from "./rate-limit";

// POST /api/agent/turn with Spark failing: the label shown under "Why
// unavailable", the single retry, the daily budget and the HOLD. Mocked HTTP.

const fetchMock = vi.fn<typeof fetch>();
const scene: Scene = { objects: ["red mug"], transcript: "confirmed" };
let sparkReplies: (() => Response)[];
let sparkCalls: number;

const isSparkReasoning = (url: string, init?: RequestInit) =>
  url.endsWith("/chat/completions") &&
  !String(JSON.parse(String(init?.body)).messages[0].content).startsWith("You transcribe text");

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubLiveEnv();
  stubMeta(fetchMock, () => scene);
  const base = fetchMock.getMockImplementation() as typeof fetch;
  sparkCalls = 0;
  fetchMock.mockImplementation(async (input, init) => {
    if (isSparkReasoning(String(input), init)) {
      const reply = sparkReplies[Math.min(sparkCalls, sparkReplies.length - 1)];
      sparkCalls++;
      if (reply) return reply();
    }
    return base(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const status = (code: number, body = "") => new Response(body, { status: code });
const okReply = () => base();
const base = () =>
  Response.json({
    choices: [{ message: { content: JSON.stringify({ claimedObjects: ["red mug"], proposedAction: "ADVANCE", rationale: "ok" }) } }],
  });

async function turn(mode: "guarded" | "unguarded") {
  const res = await POST(turnRequest({ mode }));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

describe("Spark failure on the turn route", () => {
  it.each(["guarded", "unguarded"] as const)("%s: two 500s -> HOLD, label 'spark http_5xx', nothing executed", async (mode) => {
    sparkReplies = [() => status(500, `Bearer ${FAKE_KEY} internal detail`)];
    const res = await turn(mode);
    expect(res.status).toBe(200);
    expect(sparkCalls).toBe(2);
    expect(res.body.sources.spark).toBe("unavailable");
    expect(res.body.perceptionDetail.spark).toBe("spark http_5xx");
    expect(res.body.turn.sparkDecision).toMatchObject({
      proposedAction: "HOLD",
      rationale: "reasoning unavailable: spark http_5xx",
      failure: "http_5xx",
    });
    expect(res.body.turn.executed).toBeNull();
    expect(res.text).not.toContain(FAKE_KEY);
    expect(res.text).not.toContain("internal detail");
  });

  it.each([
    [429, "spark http_429"],
    [503, "spark http_5xx"],
  ])("HTTP %i shows '%s'", async (code, label) => {
    sparkReplies = [() => status(code)];
    expect((await turn("guarded")).body.perceptionDetail.spark).toBe(label);
  });

  it("HTTP 401 is not retried and shows 'spark error'", async () => {
    sparkReplies = [() => status(401)];
    const res = await turn("guarded");
    expect(sparkCalls).toBe(1);
    expect(res.body.perceptionDetail.spark).toBe("spark error");
  });

  it.each([
    ["not JSON", () => Response.json({ choices: [{ message: { content: "ship it" } }] }), "spark bad_json"],
    ["wrong shape", () => Response.json({ choices: [{ message: { content: "{}" } }] }), "spark schema"],
    ["empty", () => Response.json({ choices: [{ message: { content: "" } }] }), "spark empty"],
  ])("a %s reply shows '%s' and the Spark badge is unavailable", async (_n, reply, label) => {
    sparkReplies = [reply];
    const res = await turn("unguarded");
    expect(res.body.perceptionDetail.spark).toBe(label);
    expect(res.body.sources.spark).toBe("unavailable");
  });

  it("a failure followed by a good reply recovers: Spark is live, no detail", async () => {
    sparkReplies = [() => status(503), okReply];
    const res = await turn("guarded");
    expect(sparkCalls).toBe(2);
    expect(res.body.sources.spark).toBe("live");
    expect(res.body.perceptionDetail.spark).toBeUndefined();
    expect(res.body.turn.guard).toEqual({ decision: "ALLOW", reason: "Verified VERIFY_MUG" });
  });
});

describe("the retry is counted in the daily budget", () => {
  // One turn reserves 8 up front: 3 concepts x 2 (SAM) + 1 (vision) + 1 (Spark).
  it("a retry spends one more unit", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "9");
    sparkReplies = [() => status(500), okReply];
    await turn("guarded");
    expect(sparkCalls).toBe(2);
    expect(consumeLiveBudget(1)).toBe(false); // 8 + 1 retry = 9 = cap
  });

  it("no retry means no extra unit", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "9");
    sparkReplies = [okReply];
    await turn("guarded");
    expect(consumeLiveBudget(1)).toBe(true); // 8 used, 1 left
  });

  it("with the budget gone the retry is skipped and the turn still HOLDs", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "8");
    sparkReplies = [() => status(500)];
    const res = await turn("guarded");
    expect(res.status).toBe(200);
    expect(sparkCalls).toBe(1);
    expect(res.body.perceptionDetail.spark).toBe("spark http_5xx");
    expect(res.body.turn.sparkDecision.proposedAction).toBe("HOLD");
    expect(res.body.turn.executed).toBeNull();
  });

  it("late in the turn (past the retry deadline) the retry is skipped", async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now");
    let calls = 0;
    clock.mockImplementation(() => (calls++ === 0 ? t0 : t0 + 40_000));
    sparkReplies = [() => status(500)];
    const res = await turn("guarded");
    clock.mockRestore();
    expect(sparkCalls).toBe(1);
    expect(res.body.perceptionDetail.spark).toBe("spark http_5xx");
  });
});
