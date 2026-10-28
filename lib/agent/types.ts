// Shared types for the headless PackProof agent loop (perceive -> decide -> act).
// Records hold summaries only: never raw image bytes, data URLs or secrets.

import type { LedgerState, LedgerStep } from "../guard/ledger";

export interface Observation {
  /** Camera frame as a data URL. Never copied into a TurnRecord. */
  frameDataUrl?: string;
  /** Fixtures only: what is "really" in the frame, fed to mock SAM/vision. */
  frameHint?: { objects: string[]; imageText: string };
  /** Voice transcript for this turn ("" when nothing was said). */
  transcript: string;
}

export type AgentAction = "ADVANCE" | "SEAL" | "SHIP" | "HOLD";

export const AGENT_ACTIONS: readonly AgentAction[] = ["ADVANCE", "SEAL", "SHIP", "HOLD"];

export interface SparkDecision {
  claimedObjects: string[];
  proposedAction: AgentAction;
  rationale: string;
  /** True only when the frame was actually sent to the reasoning model. */
  usedImage: boolean;
}

export type AgentMode = "guarded" | "unguarded";

export interface PackSession {
  ledger: LedgerState;
  sealed: boolean;
  shipped: boolean;
  log: TurnRecord[];
}

export interface ObservationSummary {
  hasFrame: boolean;
  /** e.g. "image/png"; null when there is no frame. */
  frameMimeType: string | null;
  hasFrameHint: boolean;
  transcript: string;
}

export interface TurnRecord {
  turn: number;
  mode: AgentMode;
  step: LedgerStep;
  observation: ObservationSummary;
  sparkDecision: SparkDecision;
  perception: {
    samObjects: string[];
    imageText: string;
    /** Which ImageUnderstanding produced imageText ("spark" | "ocr" | "mock"). */
    imageTextSource: string;
    transcript: string;
  };
  /** null in unguarded mode: nothing checked the action. */
  guard: { decision: "ALLOW" | "BLOCK" | "HOLD"; reason: string } | null;
  executed: AgentAction | null;
  shipped: boolean;
  ledgerStepAfter: string;
}
