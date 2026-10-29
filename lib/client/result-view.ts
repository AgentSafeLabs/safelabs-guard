// Pure view logic for the live page's result box: the verdict banner and the
// four evidence cards. It only reshapes fields the turn response already has.
// No DOM, so it is unit-tested.

import { ORDER_1042, STEPS } from "../guard/ledger";
import type { TurnRecord } from "../agent/types";
import type { TurnResponse } from "./agent-api";
import { agentSawText } from "./agent-api";

export type VerdictWord = "ALLOW" | "HOLD" | "BLOCK" | "UNGUARDED" | "SHIPPED";
export type Tone = "allow" | "hold" | "danger";

export interface VerdictView {
  word: VerdictWord;
  tone: Tone;
  /** The server's reason for the decision, or the fixed unguarded line. */
  reason: string;
  /** e.g. "Step 2 of 5 · ORDER-1042". */
  context: string;
}

export const UNGUARDED_REASON = "No guard: the agent acted on its own proposal.";
export const SHIPPED_REASON = "Shipped. Repeating this approval returns the same shipment.";

const TONE: Record<VerdictWord, Tone> = {
  ALLOW: "allow",
  SHIPPED: "allow",
  HOLD: "hold",
  UNGUARDED: "hold",
  BLOCK: "danger",
};

export function stepContext(turn: Pick<TurnRecord, "step">): string {
  const n = Math.max(0, STEPS.indexOf(turn.step)) + 1;
  return `Step ${n} of ${STEPS.length} · ${ORDER_1042.id}`;
}

export function verdictView(turn: TurnRecord, shipped: boolean): VerdictView {
  const context = stepContext(turn);
  if (shipped) return { word: "SHIPPED", tone: TONE.SHIPPED, reason: SHIPPED_REASON, context };
  const word: VerdictWord = turn.guard?.decision ?? "UNGUARDED";
  return { word, tone: TONE[word], reason: turn.guard ? turn.guard.reason : UNGUARDED_REASON, context };
}

export type EvidenceKey = "camera" | "text" | "voice" | "spark";

/**
 * Which evidence cards the guard's reason points at. Matches the fixed reason
 * strings in lib/guard/reconcile.ts, lib/guard/action-gate.ts and
 * lib/client/labels.ts; an unknown reason flags nothing.
 */
export function flaggedEvidence(guard: TurnRecord["guard"]): EvidenceKey[] {
  if (!guard || guard.decision === "ALLOW") return [];
  const r = guard.reason;
  if (r.startsWith("Injection attempt detected: image text + voice")) return ["text", "voice"];
  if (r.startsWith("Injection attempt detected: image text")) return ["text"];
  if (r.startsWith("Injection attempt detected: voice")) return ["voice"];
  if (r.startsWith("Perception mismatch") || r.startsWith("SAM ")) return ["camera"];
  if (r.startsWith("Reasoning does not match frame")) return ["spark", "camera"];
  if (r.startsWith("Voice contains an instruction") || r.startsWith("voice unavailable")) return ["voice"];
  if (r.startsWith("image text unavailable")) return ["text"];
  if (r.startsWith("Agent chose to hold") || r.startsWith("Action not allowed")) return ["spark"];
  return [];
}

/**
 * OCR on a clean image can return stray marks. Returns the cleaned text when
 * it looks like real words (a word of 3+ letters, and mostly letters/digits),
 * otherwise null. The raw string is still shown under Details.
 */
export function meaningfulText(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const words = text.split(" ");
  const hasWord = words.some((w) => (w.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && /^[A-Za-z0-9'’.,:;!?()-]+$/.test(w));
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return hasWord && alnum / text.replace(/ /g, "").length >= 0.6 ? text : null;
}

export function truncate(text: string, max = 120): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

export interface EvidenceSummaries {
  camera: string;
  text: string;
  voice: string;
  spark: string;
}

export function evidenceSummaries(response: Pick<TurnResponse, "turn" | "sources">, hadAudio: boolean, voiceNotSent: boolean): EvidenceSummaries {
  const { turn, sources } = response;
  const sam = turn.perception.samObjects;
  const spoken = turn.perception.transcript;
  const claimed = turn.sparkDecision.claimedObjects;
  return {
    camera: sources.sam === "unavailable" ? "Unavailable" : sam.length ? sam.join(", ") : "Nothing detected",
    text: sources.vision === "unavailable" ? "Unavailable" : (() => {
      const t = meaningfulText(turn.perception.imageText);
      return t ? truncate(t) : "None found";
    })(),
    voice: voiceNotSent || !hadAudio
      ? "No audio"
      : sources.voice === "unavailable"
        ? "Unavailable"
        : spoken
          ? truncate(`"${spoken}"`)
          : "No usable transcript",
    spark: `${turn.sparkDecision.proposedAction}${claimed.length ? ` · claims ${claimed.join(", ")}` : ""}`,
  };
}

/** Re-exported so the result box has one import for its display text. */
export { agentSawText };
