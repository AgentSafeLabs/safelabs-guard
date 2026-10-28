// One PackProof agent turn: perceive (SAM objects + vision text) -> decide
// (Spark) -> act (tools). Guarded mode gates the action through guardAction()
// and fails closed when perception is unavailable; unguarded mode acts on
// whatever the model proposed.

import { guardAction } from "../guard/action-gate";
import { createLedger, getExpectedObjects, type LedgerState } from "../guard/ledger";
import { describeError } from "../meta/http";
import type { SamClient, SamResult } from "../meta/sam";
import { decide, type ReasoningClient } from "./packproof";
import { redact } from "./redact";
import { executeGuarded, executeUnguarded } from "./tools";
import type {
  AgentAction,
  AgentMode,
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

export interface RunTurnOptions {
  mode: AgentMode;
  sam: SamClient;
  vision: ImageUnderstanding;
  reasoning: ReasoningClient;
  /** Guarded mode: BLOCK unless SAM's result came from the live API. */
  requireLive?: boolean;
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

  // 1. Perceive.
  let samResult: SamResult | null = null;
  let samError: string | null = null;
  try {
    samResult = await sam.segment({
      frame: observation.frameDataUrl ?? FIXTURE_FRAME,
      concepts: conceptsFor(getExpectedObjects(step)),
      mockDetections: observation.frameHint?.objects.map((label, i) => ({
        label,
        score: 0.95,
        box: [40 + i * 120, 80, 100, 100] as [number, number, number, number],
      })),
      mockImageText: observation.frameHint?.imageText,
    });
    if (samResult.error) samError = redact(samResult.error);
  } catch (err) {
    samError = redact(describeError(err));
  }
  const samObjects = samResult?.detections.map((d) => d.label) ?? [];
  const samLive = samResult?.source === "live";

  let extract: Awaited<ReturnType<ImageUnderstanding["extract"]>>;
  try {
    extract = await vision.extract(observation);
  } catch (err) {
    extract = { visibleText: "", ok: false, error: describeError(err) };
  }
  const imageText = extract.ok ? extract.visibleText : "";

  const record = (
    sparkDecision: SparkDecision,
    guard: TurnRecord["guard"],
    executed: AgentAction | null,
  ): TurnRecord => {
    const entry: TurnRecord = {
      turn: session.log.length + 1,
      mode,
      step,
      observation: summarize(observation),
      sparkDecision,
      perception: {
        samObjects,
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
    if (!extract.ok) failure = "image text unavailable";
    else if (!samResult || samError) failure = `SAM unavailable${samError ? `: ${samError}` : ""}`;
    else if (requireLive && !samLive) failure = "SAM not live";
    if (failure) return record(NOT_CONSULTED, { decision: "BLOCK", reason: failure }, null);
  }

  // 2. Decide.
  const decision = await decide(observation, step, reasoning, { visibleText: imageText });

  // 3. Act.
  if (!guarded) {
    const executed = executeUnguarded(session, decision.proposedAction);
    return record(decision, null, executed);
  }
  const gate = guardAction({
    ledgerState: ledgerBefore,
    sparkClaimedObjects: decision.claimedObjects,
    samDetectedObjects: samObjects,
    voiceTranscript: observation.transcript,
    imageText,
    proposedAction: decision.proposedAction,
  });
  const executed = executeGuarded(session, decision.proposedAction, gate);
  return record(decision, { decision: gate.decision, reason: gate.reason }, executed);
}
