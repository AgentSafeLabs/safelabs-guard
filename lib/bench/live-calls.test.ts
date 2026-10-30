import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningRequest } from "../agent/packproof";
import { MetaApiError } from "../meta/http";
import type { SamClient, SamResult } from "../meta/sam";
import { benchRetries, benchTimeoutMs, LiveCallRunner } from "./live-calls";
import { Recorder, ReplayMissError, type BenchMode, type KeyInput } from "./recorder";
import { detectObjects, RecordedReasoningClient, samKey, type Media } from "./services";

const FAKE_KEY = "test-key-not-real-abc123def456";
const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

const fetchMock = vi.fn<typeof fetch>();
let tmp: string;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  tmp = mkdtempSync(join(tmpdir(), "bench-live-"));
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  rmSync(tmp, { recursive: true, force: true });
});

function setup(mode: BenchMode, options: { retries?: number; timeoutMs?: number } = {}) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const live = new LiveCallRunner({
    ...options,
    now: () => (clock += 25),
    sleep: async (ms) => void sleeps.push(ms),
    log: (line) => lines.push(line),
  });
  const recorder = new Recorder({ mode, dir: join(tmp, "recordings"), live });
  return { recorder, live, lines, sleeps };
}

const input: KeyInput = { service: "spark-reasoning", model: "m", promptHash: "p", params: {}, inputSha256: null };
const isContent = (v: unknown): v is { content: string } => typeof v === "object" && v !== null && typeof (v as { content?: unknown }).content === "string";
const recordingCount = () => (existsSync(join(tmp, "recordings", "spark-reasoning")) ? readdirSync(join(tmp, "recordings", "spark-reasoning")).length : 0);

describe("bench live calls: retries", () => {
  it("a timeout then a success on retry records once and logs both attempts", async () => {
    const { recorder, live, lines, sleeps } = setup("record", { retries: 2 });
    recorder.caseId = "W06";
    const complete = vi.fn().mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce({ content: "ok" });
    await expect(recorder.call(input, complete, isContent)).resolves.toEqual({ content: "ok" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
    expect(recordingCount()).toBe(1);
    expect(live.stats).toEqual({ made: 1, reused: 0, failed: 0 });
    expect(lines).toEqual([
      "bench W06 spark-reasoning attempt 1/3 25ms timeout (retrying)",
      "bench W06 spark-reasoning attempt 2/3 25ms recorded",
    ]);
  });

  it("retries a 503 and a 429 with growing backoff, but not a 400", async () => {
    const { recorder, sleeps } = setup("record", { retries: 2 });
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new MetaApiError("HTTP 503 from /chat/completions", 503))
      .mockRejectedValueOnce(new MetaApiError("HTTP 429 from /chat/completions", 429))
      .mockResolvedValueOnce({ content: "ok" });
    await recorder.call(input, complete, isContent);
    expect(sleeps).toEqual([1000, 2000]);

    const other = setup("record", { retries: 2 });
    const bad = vi.fn().mockRejectedValue(new MetaApiError("HTTP 400 from /chat/completions", 400));
    await expect(other.recorder.call({ ...input, promptHash: "q" }, bad, isContent)).rejects.toThrow(/400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("a permanent timeout names the case, stops after the last attempt and writes nothing", async () => {
    const { recorder, live, lines } = setup("record", { retries: 2 });
    recorder.caseId = "W06";
    const complete = vi.fn().mockRejectedValue(timeoutError());
    await expect(recorder.call(input, complete, isContent)).rejects.toThrow(/aborted due to timeout/);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(existsSync(join(tmp, "recordings"))).toBe(false);
    expect(live.stats).toEqual({ made: 0, reused: 0, failed: 1 });
    expect(live.firstFailure).toEqual({ caseId: "W06", service: "spark-reasoning", code: "timeout", attempts: 3 });
    expect(lines.at(-1)).toBe("bench W06 spark-reasoning attempt 3/3 25ms timeout");
    expect(live.summaryLines().join("\n")).toMatch(/0 made, 0 reused, 1 failed[\s\S]*case W06 \(spark-reasoning\): timeout after 3 attempts/);
    expect(() => recorder.assertHealthy()).toThrow(/timeout/);
  });

  it("a SAM batch reported unavailable is retried as a whole and never partly written", async () => {
    const { recorder, live } = setup("record", { retries: 1 });
    recorder.caseId = "V01";
    const image: Media = { path: "assets/images/x.png", bytes: new Uint8Array([1]), sha256: "a".repeat(64), dataUrl: "data:image/png;base64,AQ==" };
    const unavailable: SamResult = { detections: [], imageText: "", source: "unavailable", error: "Timed out after 10000ms" };
    const good: SamResult = { detections: [{ label: "red mug", score: 1, box: [0, 0, 0, 0] }], imageText: "", source: "live" };
    const segment = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(good);
    const client: SamClient = { mode: "live", segment };
    const result = await detectObjects(recorder, image, ["red mug", "blue notebook"], () => client);
    expect(result.detections.map((d) => d.label)).toEqual(["red mug"]);
    expect(segment).toHaveBeenCalledTimes(2);
    expect(recorder.has(samKey(image, "red mug"))).toBe(true);
    expect(recorder.has(samKey(image, "blue notebook"))).toBe(true);
    expect(live.stats.made).toBe(1);

    const failing = setup("record", { retries: 1 });
    const never: SamClient = { mode: "live", segment: vi.fn().mockResolvedValue(unavailable) };
    const image2 = { ...image, sha256: "b".repeat(64) };
    await expect(detectObjects(failing.recorder, image2, ["red mug"], () => never)).rejects.toThrow(/Live SAM failed/);
    expect(failing.recorder.has(samKey(image2, "red mug"))).toBe(false);
    expect(failing.live.firstFailure?.code).toBe("timeout");
  });
});

describe("bench live calls: reuse, replay and timeout override", () => {
  it("reused recordings are reported but not counted as calls made", async () => {
    const first = setup("record");
    await first.recorder.call(input, async () => ({ content: "ok" }), isContent);
    const second = setup("record");
    second.recorder.caseId = "N01";
    const complete = vi.fn();
    await expect(second.recorder.call(input, complete, isContent)).resolves.toEqual({ content: "ok" });
    expect(complete).not.toHaveBeenCalled();
    expect(second.recorder.liveCalls).toBe(0);
    expect(second.live.stats).toEqual({ made: 0, reused: 1, failed: 0 });
    expect(second.lines).toEqual(["bench N01 spark-reasoning reused"]);
  });

  it("replay never calls live, never retries and never touches the network", async () => {
    const { recorder, live, sleeps } = setup("replay", { retries: 5 });
    const complete = vi.fn();
    await expect(recorder.call(input, complete, isContent)).rejects.toBeInstanceOf(ReplayMissError);
    expect(complete).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
    expect(live.stats).toEqual({ made: 0, reused: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SAFELABS_BENCH_TIMEOUT_MS reaches the Spark request; unset leaves the request alone", async () => {
    const seen: (number | undefined)[] = [];
    const spark = {
      messagesFor: (r: ReasoningRequest) => r.messages,
      complete: async (r: ReasoningRequest) => {
        seen.push(r.timeoutMs);
        return "{}";
      },
    };
    const request = { messages: [{ role: "user", content: "hi" }], timeoutMs: 20_000 } as unknown as ReasoningRequest;
    await new RecordedReasoningClient(setup("live", { timeoutMs: 45_000 }).recorder, spark).complete(request);
    await new RecordedReasoningClient(setup("live").recorder, spark).complete(request);
    expect(seen).toEqual([45_000, 20_000]);
  });

  it("parses the env vars: defaults, valid values, and rejects nonsense", () => {
    expect(benchTimeoutMs({})).toBeUndefined();
    expect(benchRetries({})).toBe(2);
    expect(benchTimeoutMs({ SAFELABS_BENCH_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(benchRetries({ SAFELABS_BENCH_RETRIES: "0" })).toBe(0);
    expect(() => benchTimeoutMs({ SAFELABS_BENCH_TIMEOUT_MS: "soon" })).toThrow(/SAFELABS_BENCH_TIMEOUT_MS/);
    expect(() => benchRetries({ SAFELABS_BENCH_RETRIES: "-1" })).toThrow(/SAFELABS_BENCH_RETRIES/);
  });
});

describe("bench live calls: logging", () => {
  it("log lines carry no keys, headers, payloads or error text", async () => {
    const { recorder, live, lines } = setup("record", { retries: 1 });
    recorder.caseId = "A01";
    const leaky = new Error(`Authorization: Bearer ${FAKE_KEY} https://api.meta.ai/v1/files?token=${FAKE_KEY}`);
    await expect(recorder.call(input, async () => Promise.reject(leaky), isContent)).rejects.toThrow();
    await recorder.call({ ...input, promptHash: "z" }, async () => ({ content: "ok" }), isContent);
    const text = [...lines, ...live.summaryLines()].join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/bearer|authorization|https?:\/\/|api\.meta\.ai/i);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{24,}/);
    for (const line of lines) expect(line).toMatch(/^bench [A-Z0-9-]+ [a-z-]+ (attempt \d\/\d \d+ms [a-z0-9:() -]+|reused( x\d+)?)$/i);
  });
});
