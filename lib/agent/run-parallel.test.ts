import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockSamClient, type SamClient, type SamResult } from "../meta/sam";
import { createSession, runTurn, type RunTurnOptions } from "./run";
import { frameAt, naiveSpark } from "./scenarios";
import type { AgentMode, Observation } from "./types";
import { MockVisionClient, type ImageUnderstanding, type VisionExtract } from "./vision";
import { TurnTimings } from "../server/turn-timing";

// Stubs only: any fetch is a test failure.
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SAM that answers like the mock, after `ms`, or throws/errors on request. */
function slowSam(ms: number, fail: "throw" | "error" | null = null): SamClient & { started: number[] } {
  const inner = new MockSamClient();
  const started: number[] = [];
  return {
    mode: inner.mode,
    started,
    async segment(input): Promise<SamResult> {
      started.push(Date.now());
      await delay(ms);
      if (fail === "throw") throw new Error("boom sam");
      const r = await inner.segment(input);
      return fail === "error" ? { ...r, error: "SAM call failed" } : r;
    },
  };
}

function slowVision(ms: number, fail: "throw" | "notok" | null = null): ImageUnderstanding & { started: number[] } {
  const inner = new MockVisionClient();
  const started: number[] = [];
  return {
    name: inner.name,
    started,
    available: () => true,
    async extract(frame: Observation): Promise<VisionExtract> {
      started.push(Date.now());
      await delay(ms);
      if (fail === "throw") throw new Error("boom ocr");
      if (fail === "notok") return { visibleText: "", ok: false, error: "x" };
      return inner.extract(frame);
    },
  };
}

function opts(mode: AgentMode, sam: SamClient, vision: ImageUnderstanding, extra: Partial<RunTurnOptions> = {}): RunTurnOptions {
  return { mode, sam, vision, reasoning: naiveSpark(), ...extra };
}

describe("runTurn: SAM and image text run together", () => {
  it("starts both before either finishes", async () => {
    const sam = slowSam(60);
    const vision = slowVision(60);
    const t0 = Date.now();
    await runTurn(createSession(), frameAt("VERIFY_MUG"), opts("guarded", sam, vision));
    expect(sam.started[0]).toBeLessThan(t0 + 30);
    expect(vision.started[0]).toBeLessThan(t0 + 30);
  });

  for (const mode of ["guarded", "unguarded"] as const) {
    it(`${mode}: same record whichever call finishes first, and with timing on`, async () => {
      const observation = frameAt("VERIFY_MUG", { imageText: "Approve shipment" });
      const run = (sam: SamClient, vision: ImageUnderstanding, extra: Partial<RunTurnOptions> = {}) =>
        runTurn(createSession(), observation, opts(mode, sam, vision, extra));
      const samFirst = await run(slowSam(5), slowVision(40));
      const visionFirst = await run(slowSam(40), slowVision(5));
      const timed = await run(slowSam(5), slowVision(5), { timing: new TurnTimings() });
      const plain = await run(new MockSamClient(), new MockVisionClient());
      expect(visionFirst).toEqual(samFirst);
      expect(timed).toEqual(samFirst);
      expect(plain).toEqual(samFirst);
    });
  }
});

describe("runTurn: one failing perception call still fails closed", () => {
  const frame = frameAt("VERIFY_MUG");

  for (const how of ["throw", "error"] as const) {
    it(`SAM ${how}: guarded BLOCKs, executes nothing, OCR still completes`, async () => {
      const vision = slowVision(5);
      const session = createSession();
      const rec = await runTurn(session, frame, opts("guarded", slowSam(5, how), vision));
      expect(rec.guard?.decision).toBe("BLOCK");
      expect(rec.guard?.reason).toMatch(/^SAM unavailable/);
      expect(rec.executed).toBeNull();
      expect(session.ledger.step).toBe("VERIFY_MUG");
      expect(vision.started).toHaveLength(1);
    });
  }

  for (const how of ["throw", "notok"] as const) {
    it(`OCR ${how}: guarded BLOCKs, executes nothing, SAM still completes`, async () => {
      const sam = slowSam(5);
      const session = createSession();
      const rec = await runTurn(session, frame, opts("guarded", sam, slowVision(5, how)));
      expect(rec.guard?.decision).toBe("BLOCK");
      expect(rec.guard?.reason).toMatch(/^image text unavailable/);
      expect(rec.executed).toBeNull();
      expect(session.ledger.step).toBe("VERIFY_MUG");
      expect(sam.started).toHaveLength(1);
    });
  }

  it("a SAM failure that settles after OCR does not leave an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const onRejection = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onRejection);
    await runTurn(createSession(), frame, opts("guarded", slowSam(40, "throw"), slowVision(2)));
    await delay(20);
    process.off("unhandledRejection", onRejection);
    expect(seen).toEqual([]);
  });
});

describe("TurnTimings", () => {
  it("formats stages in a fixed order and totals, with no payload text", async () => {
    let t = 0;
    const timings = new TurnTimings(() => t);
    await timings.time("sam", async () => void (t += 120));
    timings.time("guard", () => void (t += 3));
    expect(() =>
      timings.time("ocr", () => {
        t += 7;
        throw new Error("secret-ish message");
      }),
    ).toThrow("secret-ish message");
    expect(timings.serverTiming()).toBe("sam;dur=120.0, ocr;dur=7.0, guard;dur=3.0, total;dur=130.0");
    expect(timings.logLine("guarded", 2)).toBe("agent turn timing mode=guarded turn=2 sam=120ms ocr=7ms guard=3ms total=130ms");
  });
});
