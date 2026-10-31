// One PackProof agent turn: perceive (SAM objects + vision text) -> decide
// (Spark, given a perception report built from both) -> act (tools). Guarded mode gates the action through guardAction()
// and fails closed when perception is unavailable; unguarded mode acts on
// whatever the model proposed.

import { guardAction } from "../guard/action-gate";
import { createLedger, getExpectedObjects, type LedgerState } from "../guard/ledger";
import { describeError } from "../meta/http";
import type { SamClient, SamResult } from "../meta/sam";
import { buildDetectedObjects, decide, type ReasoningClient, type SparkRetryPolicy } from "./packproof";
import { safeDetail } from "./perception-detail";
import { redact } from "./redact";
import { executeGuarded, executeUnguarded } from "./tools";
import type {
  AgentAction,
  AgentMode,
  DetectedObject,
  Observation,
  ObservationSummary,
  PackSession,
  SparkDecision,
  TurnRecord,
} from "./types";
import type { ImageUnderstanding } from "./vision";

/** Unordered objects SAM is also asked about, so live SAM can report them. */
export const DISTRACTORS = ["banana", "blue mug", "red notebook", "usb-a cable"] as const;
const DISTRACTOR_COUNT = 2;

/** Frame reference for fixture-only observations (no real image). */
const FIXTURE_FRAME = "mock://agent/frame";

/** Optional per-stage timer (lib/server/turn-timing.ts). Sees no payloads, only stage names. */
export interface StageTimer {
  time<T>(stage: "sam" | "ocr" | "spark" | "guard", fn: () => T): T;
}

export interface RunTurnOptions {
  mode: AgentMode;
  sam: SamClient;
  vision: ImageUnderstanding;
  reasoning: ReasoningClient;
  /** Guarded mode: BLOCK unless SAM's result came from the live API. */
  requireLive?: boolean;
  /**
   * The concepts SAM is asked about, and the only labels the agent may be
   * told about. Default: the step's expected objects plus 2 DISTRACTORS.
   */
  concepts?: readonly string[];
  /** One bounded retry of the reasoning call. Same in both modes; omitted = no retry. */
  sparkRetry?: SparkRetryPolicy;
  /** Per-stage wall-clock timing. Never changes a result. */
  timing?: StageTimer;
}

export function createSession(ledger: LedgerState = createLedger()): PackSession {
  return { ledger, sealed: false, shipped: false, log: [] };
}

export function conceptsFor(expected: readonly string[]): string[] {
  const distractors = DISTRACTORS.filter((d) => !expected.includes(d)).slice(0, DISTRACTOR_COUNT);
  return [...expected, ...distractors];
}

function summarize(observation: Observation): ObservationSummary {
  const mime = observation.frameDataUrl ? /^data:([^;,]+)/.exec(observation.frameDataUrl)?.[1] ?? "unknown" : null;
  return {
    hasFrame: Boolean(observation.frameDataUrl),
    frameMimeType: mime,
    hasFrameHint: Boolean(observation.frameHint),
    transcript: redact(observation.transcript),
  };
}

function ledgerLabel(ledger: LedgerState): string {
  return ledger.status === "COMPLETE" ? "COMPLETE" : ledger.step;
}

const NOT_CONSULTED: SparkDecision = {
  claimedObjects: [],
  proposedAction: "HOLD",
  rationale: "not consulted: perception failed closed",
  usedImage: false,
};

export async function runTurn(
  session: PackSession,
  observation: Observation,
  options: RunTurnOptions,
): Promise<TurnRecord> {
  const { mode, sam, vision, reasoning, requireLive = false } = options;
  const guarded = mode === "guarded";
  const ledgerBefore = session.ledger;
  const step = ledgerBefore.step;
  const concepts = [...(options.concepts ?? conceptsFor(getExpectedObjects(step)))];

  // 1. Perceive. SAM and the image-text read take the same frame and neither
  // uses the other's output, so they run together. Each catches its own
  // failure exactly as before, so the outcome is the same as running in turn.
  const time: StageTimer["time"] = options.timing ? (stage, fn) => options.timing!.time(stage, fn) : (_stage, fn) => fn();
  const perceiveSam = async (): Promise<{ result: SamResult | null; error: string | null }> => {
    try {
      const result = await time("sam", () =>
        sam.segment({
          frame: observation.frameDataUrl ?? FIXTURE_FRAME,
          concepts: [...concepts],
          mockDetections: observation.frameHint?.objects.map((label, i) => ({
            label,
            score: 0.95,
            box: [40 + i * 120, 80, 100, 100] as [number, number, number, number],
          })),
          mockImageText: observation.frameHint?.imageText,
        }),
      );
      return { result, error: result.error ? redact(result.error) : null };
    } catch (err) {
      return { result: null, error: redact(describeError(err)) };
    }
  };
  const perceiveText = async (): Promise<Awaited<ReturnType<ImageUnderstanding["extract"]>>> => {
    try {
      return await time("ocr", () => vision.extract(observation));
    } catch (err) {
      return { visibleText: "", ok: false, error: describeError(err) };
    }
  };
  const [samOutcome, extract] = await Promise.all([perceiveSam(), perceiveText()]);
  const samResult = samOutcome.result;
  const samError = samOutcome.error;
  // The guard checks every label SAM returned; the agent sees only known concepts.
  const samObjects = samResult?.detections.map((d) => d.label) ?? [];
  const samLive = samResult?.source === "live";
  const detectedObjects = buildDetectedObjects(samResult?.detections ?? [], concepts);
  const imageText = extract.ok ? extract.visibleText : "";

  const record = (
    sparkDecision: SparkDecision,
    guard: TurnRecord["guard"],
    executed: AgentAction | null,
    agentSaw: DetectedObject[],
  ): TurnRecord => {
    const entry: TurnRecord = {
      turn: session.log.length + 1,
      mode,
      step,
      observation: summarize(observation),
      sparkDecision,
      perception: {
        samObjects,
        agentSaw,
        imageText: redact(imageText),
        imageTextSource: vision.name,
        transcript: redact(observation.transcript),
      },
      guard: guard && { decision: guard.decision, reason: redact(guard.reason) },
      executed,
      shipped: session.shipped,
      ledgerStepAfter: ledgerLabel(session.ledger),
    };
    session.log.push(entry);
    return entry;
  };

  // Fail closed: in guarded mode, unknown perception executes nothing.
  if (guarded) {
    let failure: string | null = null;
    if (!extract.ok) {
      // Only allow-listed labels ("ocr timeout", ...), never upstream error text.
      const detail = safeDetail(extract.perceptionDetail);
      failure = detail ? `image text unavailable: ${detail}` : "image text unavailable";
    }
    else if (!samResult || samError) failure = `SAM unavailable${samError ? `: ${samError}` : ""}`;
    else if (requireLive && !samLive) failure = "SAM not live";
    if (failure) return record(NOT_CONSULTED, { decision: "BLOCK", reason: failure }, null, []);
  }

  // 2. Decide. Same input in both modes: only the action gate below differs.
  const decision = await time("spark", () =>
    decide(observation, step, reasoning, {
      visibleText: imageText,
      detectedObjects,
      retry: options.sparkRetry,
    }),
  );

  // 3. Act.
  if (!guarded) {
    const executed = executeUnguarded(session, decision.proposedAction);
    return record(decision, null, executed, detectedObjects);
  }
  const gate = time("guard", () =>
    guardAction({
      ledgerState: ledgerBefore,
      sparkClaimedObjects: decision.claimedObjects,
      samDetectedObjects: samObjects,
      voiceTranscript: observation.transcript,
      imageText,
      proposedAction: decision.proposedAction,
    }),
  );
  const executed = executeGuarded(session, decision.proposedAction, gate);
  return record(decision, { decision: gate.decision, reason: gate.reason }, executed, detectedObjects);
}
