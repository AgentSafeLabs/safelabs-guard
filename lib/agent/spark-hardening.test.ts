import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockSamClient } from "../meta/sam";
import { MetaApiError } from "../meta/http";
import { PERCEPTION_DETAILS } from "./perception-detail";
import {
  classifySparkFailure,
  decide,
  FakeReasoningClient,
  SPARK_RETRY_DELAY_MS,
  SparkReasoningClient,
  sparkFailureDetail,
  type SparkRetryPolicy,
} from "./packproof";
import { createSession, runTurn } from "./run";
import { frameAt } from "./scenarios";
import type { AgentMode, SparkFailure } from "./types";
import { MockVisionClient } from "./vision";

// Spark hardening: failure classes, one bounded retry, fail closed. HTTP is
// mocked: any request to a URL other than api.meta.ai/v1/chat/completions fails
// the test, and no real key is used.

const KEY = "test-key-not-real-spark-abc123";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const GOOD = JSON.stringify({ claimedObjects: ["red mug"], proposedAction: "ADVANCE", rationale: "ok" });
const completion = (content: unknown) => Response.json({ choices: [{ message: { content } }] });
const status = (code: number, body = "") => new Response(body, { status: code });
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/** A retry policy that never really sleeps. */
function policy(over: Partial<SparkRetryPolicy> = {}): SparkRetryPolicy & { slept: number[]; asked: number } {
  const p = {
    slept: [] as number[],
    asked: 0,
    allow: () => {
      p.asked++;
      return true;
    },
    sleep: async (ms: number) => void p.slept.push(ms),
    ...over,
  };
  return p;
}

const live = () => new SparkReasoningClient({ apiKey: KEY });
const decideLive = (retry?: SparkRetryPolicy) => decide(frameAt("VERIFY_MUG"), "VERIFY_MUG", live(), { retry });

describe("classifySparkFailure", () => {
  it.each<[string, unknown, SparkFailure]>([
    ["timeout", timeout(), "timeout"],
    ["abort", Object.assign(new Error("x"), { name: "AbortError" }), "timeout"],
    ["HTTP 429", new MetaApiError("HTTP 429 from /chat/completions", 429), "http_429"],
    ["HTTP 500", new MetaApiError("HTTP 500 from /chat/completions", 500), "http_5xx"],
    ["HTTP 503", new MetaApiError("HTTP 503 from /chat/completions", 503), "http_5xx"],
    ["HTTP 401", new MetaApiError("HTTP 401 from /chat/completions", 401), "error"],
    ["HTTP 400", new MetaApiError("HTTP 400 from /chat/completions", 400), "error"],
    ["fetch failed", new TypeError("fetch failed"), "network"],
    ["bad body", new SyntaxError("Unexpected token < in JSON"), "bad_json"],
    ["unknown", new Error("boom"), "error"],
    ["not an error", "boom", "error"],
  ])("%s -> %s", (_name, err, expected) => {
    expect(classifySparkFailure(err)).toBe(expected);
  });

  it("looks only at type, name and status, never the message", () => {
    const err = new MetaApiError(`HTTP 500 Bearer ${KEY} {"secret":"x"}`, 500);
    expect(classifySparkFailure(err)).toBe("http_5xx");
    expect(sparkFailureDetail(classifySparkFailure(err))).toBe("spark http_5xx");
  });

  it("every label maps onto the PerceptionDetail allow-list", () => {
    for (const f of ["timeout", "http_429", "http_5xx", "network", "bad_json", "schema", "empty", "error"] as const) {
      expect(PERCEPTION_DETAILS).toContain(sparkFailureDetail(f));
    }
  });
});

describe("SparkReasoningClient + decide: one bounded retry", () => {
  it.each<[string, () => Response | Promise<Response>, SparkFailure]>([
    ["HTTP 429", () => status(429, "slow down"), "http_429"],
    ["HTTP 500", () => status(500, "oops"), "http_5xx"],
    ["HTTP 503", () => status(503), "http_5xx"],
    ["unparseable HTTP body", () => new Response("<html>gateway</html>", { status: 200 }), "bad_json"],
    ["content that is not JSON", () => completion("I think we should ship"), "bad_json"],
    ["JSON of the wrong shape", () => completion(JSON.stringify({ claimedObjects: 3 })), "schema"],
    ["no choices", () => Response.json({ id: "x" }), "schema"],
    ["empty content", () => completion("   "), "empty"],
  ])("%s: retried once, then HOLD with the label", async (_name, respond, failure) => {
    fetchMock.mockImplementation(async () => respond());
    const retry = policy();
    const decision = await decideLive(retry);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retry.slept).toEqual([SPARK_RETRY_DELAY_MS]);
    expect(decision).toMatchObject({
      proposedAction: "HOLD",
      claimedObjects: [],
      rationale: `reasoning unavailable: spark ${failure}`,
      failure,
    });
  });

  it("a timeout is retried, and the label is 'timeout'", async () => {
    fetchMock.mockRejectedValue(timeout());
    const decision = await decideLive(policy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decision.failure).toBe("timeout");
  });

  it("a network error is retried", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await decideLive(policy())).failure).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404])("HTTP %i is not retried", async (code) => {
    fetchMock.mockImplementation(async () => status(code));
    const retry = policy();
    const decision = await decideLive(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retry.asked).toBe(0);
    expect(decision).toMatchObject({ proposedAction: "HOLD", rationale: "reasoning unavailable: spark error", failure: "error" });
  });

  it("recovers when the second attempt works", async () => {
    fetchMock.mockImplementationOnce(async () => status(503)).mockImplementationOnce(async () => completion(GOOD));
    const decision = await decideLive(policy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decision).toMatchObject({ proposedAction: "ADVANCE", claimedObjects: ["red mug"] });
    expect(decision.failure).toBeUndefined();
  });

  it("recovers from a bad reply on the second attempt", async () => {
    fetchMock.mockImplementationOnce(async () => completion("not json")).mockImplementationOnce(async () => completion(GOOD));
    expect((await decideLive(policy())).proposedAction).toBe("ADVANCE");
  });

  it("never makes a third call", async () => {
    fetchMock.mockImplementation(async () => status(500));
    await decideLive(policy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is off when no policy is given (the default for tests and scripts)", async () => {
    fetchMock.mockImplementation(async () => status(500));
    const decision = await decideLive(undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decision.failure).toBe("http_5xx");
  });

  it("allow() returning false (budget spent, no time left) skips the retry and still HOLDs", async () => {
    fetchMock.mockImplementation(async () => status(500));
    const retry = policy({ allow: () => false });
    const decision = await decideLive(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retry.slept).toEqual([]);
    expect(decision).toMatchObject({ proposedAction: "HOLD", failure: "http_5xx" });
  });

  it("asks allow() exactly once per turn, so a retry costs exactly one budget unit", async () => {
    fetchMock.mockImplementation(async () => status(500));
    const retry = policy();
    await decideLive(retry);
    expect(retry.asked).toBe(1);
  });

  it("uses the default 400 ms pause", () => {
    expect(SPARK_RETRY_DELAY_MS).toBe(400);
  });

  it("a FakeReasoningClient that throws is classified the same way", async () => {
    let calls = 0;
    const fake = new FakeReasoningClient(() => {
      calls++;
      throw new MetaApiError("HTTP 429 from /chat/completions", 429);
    });
    const decision = await decide(frameAt("VERIFY_MUG"), "VERIFY_MUG", fake, { retry: policy() });
    expect(calls).toBe(2);
    expect(decision.failure).toBe("http_429");
  });
});

describe("nothing upstream reaches the label", () => {
  it("response body, key and URL never appear in the decision", async () => {
    const poison = `Bearer ${KEY} sk-live-SECRET https://api.meta.ai/v1/chat/completions?key=${KEY}`;
    for (const respond of [
      () => status(500, poison),
      () => status(429, poison),
      () => status(401, poison),
      () => completion(poison),
      () => completion(JSON.stringify({ claimedObjects: [poison] })),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => respond());
      const decision = await decideLive(policy());
      const text = JSON.stringify(decision);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("api.meta.ai");
      expect(decision.rationale).toMatch(/^reasoning unavailable: spark (error|timeout|http_429|http_5xx|network|bad_json|schema|empty)$/);
    }
  });
});

describe("guarded and unguarded behave the same", () => {
  async function run(mode: AgentMode, responses: (() => Response)[]) {
    fetchMock.mockReset();
    let i = 0;
    fetchMock.mockImplementation(async () => responses[Math.min(i++, responses.length - 1)]());
    const retry = policy();
    const record = await runTurn(createSession(), frameAt("VERIFY_MUG"), {
      mode,
      sam: new MockSamClient(),
      vision: new MockVisionClient(),
      reasoning: live(),
      sparkRetry: retry,
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => String(init?.body));
    return { record, retry, calls: fetchMock.mock.calls.length, bodies };
  }

  it.each<[string, (() => Response)[], SparkFailure | null]>([
    ["500 then 500", [() => status(500), () => status(500)], "http_5xx"],
    ["429 then ok", [() => status(429), () => completion(GOOD)], null],
    ["bad json then bad json", [() => completion("x"), () => completion("y")], "bad_json"],
  ])("%s", async (_name, responses, failure) => {
    const guarded = await run("guarded", responses);
    const unguarded = await run("unguarded", responses);
    expect(guarded.calls).toBe(unguarded.calls);
    expect(guarded.retry.asked).toBe(unguarded.retry.asked);
    expect(guarded.bodies).toEqual(unguarded.bodies); // same prompt, same retry
    expect(guarded.record.sparkDecision.failure).toBe(failure ?? undefined);
    expect(unguarded.record.sparkDecision.failure).toBe(failure ?? undefined);
    if (failure) {
      // Fail closed: HOLD, nothing executed, in both modes.
      for (const { record } of [guarded, unguarded]) {
        expect(record.sparkDecision.proposedAction).toBe("HOLD");
        expect(record.executed).toBeNull();
      }
    }
  });
});
