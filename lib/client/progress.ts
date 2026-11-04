// Pure derivation of the live page's progress card from ledger state. No DOM,
// so it is unit-tested. Everything comes from the ledger the server returned
// (and the latest guard decision); nothing is stored separately.

import { STEPS, type LedgerStep } from "../guard/ledger";

export const STEP_NAMES: Readonly<Record<LedgerStep, string>> = {
  VERIFY_MUG: "Verify the mug",
  VERIFY_NOTEBOOK: "Verify the notebook",
  VERIFY_CABLE: "Verify the cable",
  SEAL: "Seal the box",
  SHIP: "Ship the order",
};

/** Labels under the five segments, in step order. */
export const STEP_SHORT = ["Mug", "Notebook", "Cable", "Seal", "Ship"] as const;

export type SegmentState = "done" | "current" | "held" | "blocked" | "pending";

export interface ProgressView {
  /** 1-based number shown as "Step N of 5". */
  stepNumber: number;
  total: number;
  /** Human name of the step being worked on. */
  name: string;
  /** Human name of the following step; null on the last step. */
  next: string | null;
  complete: boolean;
  segments: { label: string; state: SegmentState }[];
}

export interface LedgerLike {
  stepIndex: number;
  status: "IN_PROGRESS" | "COMPLETE";
}

/**
 * `ledger` is null before the first turn. `lastDecision` is the latest turn's
 * guard decision (null when unguarded or no turn yet); a HOLD (the agent's own
 * choice) shows "held", a BLOCK (a Guard refusal) shows "blocked"; either way
 * the current step did not advance.
 */
export function deriveProgress(ledger: LedgerLike | null, lastDecision: string | null): ProgressView {
  const total = STEPS.length;
  const complete = ledger?.status === "COMPLETE";
  const raw = ledger ? (complete ? total : ledger.stepIndex) : 0;
  const index = Math.min(Math.max(Number.isInteger(raw) ? raw : 0, 0), total);
  const currentIndex = Math.min(index, total - 1);
  const held = !complete && lastDecision === "HOLD";
  const blocked = !complete && lastDecision === "BLOCK";
  return {
    stepNumber: currentIndex + 1,
    total,
    name: STEP_NAMES[STEPS[currentIndex]],
    next: currentIndex + 1 < total ? STEP_NAMES[STEPS[currentIndex + 1]] : null,
    complete,
    segments: STEPS.map((_, i) => ({
      label: STEP_SHORT[i],
      state: i < index ? "done" : i === index ? (blocked ? "blocked" : held ? "held" : "current") : "pending",
    })),
  };
}
