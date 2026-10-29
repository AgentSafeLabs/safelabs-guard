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

/** One object the camera detector (SAM) found, as given to the reasoning model. */
export interface DetectedObject {
  /** A concept from the vocabulary the server queried, never free text from a service. */
  label: string;
  /** 0-1, rounded to 2 decimals. */
  confidence: number;
}

/** Why a Spark call produced no usable decision. "error" is anything else (401, 400, ...). */
export type SparkFailure = "timeout" | "http_429" | "http_5xx" | "network" | "bad_json" | "schema" | "empty" | "error";

export interface SparkDecision {
  claimedObjects: string[];
  proposedAction: AgentAction;
  rationale: string;
  /** True only when the frame was actually sent to the reasoning model. */
  usedImage: boolean;
  /**
   * Set only when the model could not be consulted or its reply was unusable
   * (the decision is then a HOLD). A fixed label, never upstream text.
   */
  failure?: SparkFailure;
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
    /** The detected objects given to the reasoning model; empty when it was not consulted. */
    agentSaw: DetectedObject[];
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
