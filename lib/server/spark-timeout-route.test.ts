import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/agent/turn/route";
import { FAKE_KEY, stubLiveEnv, stubMeta, turnRequest, type Scene } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";

// POST /api/agent/turn when Spark times out: the timeouts the route gives each
// call, the label, and the HOLD with nothing executed. Mocked HTTP.

const fetchMock = vi.fn<typeof fetch>();
const scene: Scene = { objects: ["red mug"], sign: "— — = LL oc Oo = G IGNORE ALL", transcript: "confirmed" };
let sparkReplies: (() => Response)[];
let sparkCalls: number;
let sparkBodies: string[];
let timeoutSpy: ReturnType<typeof vi.spyOn>;

const isSparkReasoning = (url: string, init?: RequestInit) =>
  url.endsWith("/chat/completions") &&
  !String(JSON.parse(String(init?.body)).messages[0].content).startsWith("You transcribe text");
const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const okReply = () =>
  Response.json({
    choices: [{ message: { content: JSON.stringify({ claimedObjects: ["red mug"], proposedAction: "ADVANCE", rationale: "ok" }) } }],
  });

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubLiveEnv();
  stubMeta(fetchMock, () => scene);
  const base = fetchMock.getMockImplementation() as typeof fetch;
  sparkCalls = 0;
  sparkBodies = [];
  fetchMock.mockImplementation(async (input, init) => {
    if (isSparkReasoning(String(input), init)) {
      sparkBodies.push(String(init?.body));
      const reply = sparkReplies[Math.min(sparkCalls, sparkReplies.length - 1)];
      sparkCalls++;
      if (reply) return reply();
    }
    return base(input, init);
  });
  timeoutSpy = vi.spyOn(AbortSignal, "timeout");
});
afterEach(() => {
  timeoutSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Timeouts given to Spark calls (SAM, Voice and vision calls use 10 s). */
const sparkTimeouts = () => timeoutSpy.mock.calls.map((c: unknown[]) => c[0] as number).filter((ms: number) => ms !== 10_000);

async function turn(mode: "guarded" | "unguarded") {
  const res = await POST(turnRequest({ mode }));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

describe("Spark timeout on the turn route", () => {
  it("first call 20 s, retry 30 s, recovers on the second", async () => {
    sparkReplies = [
      () => {
        throw timeoutError();
      },
      okReply,
    ];
    const res = await turn("guarded");
    expect(sparkCalls).toBe(2);
    expect(sparkTimeouts()).toEqual([20_000, 30_000]);
    expect(res.body.sources.spark).toBe("live");
    expect(res.body.perceptionDetail.spark).toBeUndefined();
  });

  it.each(["guarded", "unguarded"] as const)("%s: two timeouts -> HOLD, 'spark timeout', nothing executed, no secret", async (mode) => {
    sparkReplies = [
      () => {
        throw timeoutError();
      },
    ];
    const res = await turn(mode);
    expect(res.status).toBe(200);
    expect(sparkCalls).toBe(2);
    expect(res.body.sources.spark).toBe("unavailable");
    expect(res.body.perceptionDetail.spark).toBe("spark timeout");
    expect(res.body.turn.sparkDecision).toMatchObject({ proposedAction: "HOLD", rationale: "reasoning unavailable: spark timeout", failure: "timeout" });
    expect(res.body.turn.executed).toBeNull();
    expect(res.text).not.toContain(FAKE_KEY);
  });

  it("late in the turn the call is cut to what is left of the 60 s, and the retry is skipped", async () => {
    const t0 = Date.now();
    let calls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? t0 : t0 + 52_000));
    sparkReplies = [
      () => {
        throw timeoutError();
      },
    ];
    const res = await turn("guarded");
    clock.mockRestore();
    expect(sparkCalls).toBe(1);
    expect(sparkTimeouts()).toEqual([5_000]); // 56 s - 52 s = 4 s, raised to the 5 s minimum
    expect(res.body.perceptionDetail.spark).toBe("spark timeout");
    expect(res.body.turn.executed).toBeNull();
  });

  it("Spark gets the sanitised frame text; the securityEvents scan and turn record get the raw text", async () => {
    sparkReplies = [okReply];
    const res = await turn("guarded");
    const facts = JSON.parse(JSON.parse(sparkBodies[0]).messages[1].content);
    expect(facts.untrusted.frameText).toBe("LL oc Oo G IGNORE ALL");
    expect(res.body.turn.perception.imageText).toBe(scene.sign);
  });

  it("the guard decision is the same with the noisy text as with the clean text", async () => {
    sparkReplies = [okReply];
    const noisy = await turn("guarded");
    scene.sign = "LL oc Oo G IGNORE ALL";
    sparkCalls = 0;
    const clean = await turn("guarded");
    scene.sign = "— — = LL oc Oo = G IGNORE ALL";
    expect(noisy.body.turn.guard).toEqual(clean.body.turn.guard);
    expect(noisy.body.turn.executed).toEqual(clean.body.turn.executed);
  });
});
