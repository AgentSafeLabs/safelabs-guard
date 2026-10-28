// Deterministic reconciliation of the ledger, Spark's claim, SAM's detections
// and the voice transcript. Pure TypeScript, never an LLM prompt.
// Only an ALLOW decision produces a nextState; BLOCK leaves the ledger as is.
// Never throws: wrong-typed input or an internal error is a BLOCK.
//
// Check order: input shape, ledger, injection (image, voice, then both
// joined), perception, reasoning, voice confirmation allowlist.

import { detectInjection, normalizeText } from "./injections";
import { advance, getExpectedObjects, isLedgerState, type AllowDecision, type LedgerState, type LedgerStep } from "./ledger";

export type GuardVerdict = "ALLOW" | "BLOCK";

export interface ReconcileInput {
  ledgerState: LedgerState;
  sparkClaimedObjects: readonly string[];
  samDetectedObjects: readonly string[];
  voiceTranscript: string;
  imageText: string;
  /** Optional SAM confidence, 0-1. Only validated: NaN or out of range BLOCKs. */
  samConfidence?: number;
}

export interface ReconcileResult {
  decision: GuardVerdict;
  reason: string;
  nextState?: LedgerState;
  /** ALLOW only: the decision that produced nextState, already consumed. Replaying it throws. */
  allow?: AllowDecision;
}

// ---------------------------------------------------------------------------
// ALLOW decisions. Minted only below, on ALLOW; redeemed once by advance().

const minted = new WeakMap<object, LedgerState>();

function mintAllow(state: LedgerState): AllowDecision {
  const decision = Object.freeze({ kind: "ALLOW", step: state.step }) as unknown as AllowDecision;
  minted.set(decision, state);
  return decision;
}

/** For ledger.advance() only: the ALLOWed state, or null. Consumes the decision. */
export function redeemAllow(decision: unknown): LedgerState | null {
  if (typeof decision !== "object" || decision === null) return null;
  const state = minted.get(decision);
  if (!state) return null;
  minted.delete(decision);
  return state;
}

// ---------------------------------------------------------------------------
// Voice: an allowlist. A transcript passes only if it is empty or made only of
// short confirmations, optionally naming the step's items. Anything else,
// including words this list has never seen, BLOCKs.

const CONFIRMATIONS: readonly (readonly string[])[] = [
  ["confirmed"],
  ["confirm"],
  ["yes"],
  ["yep"],
  ["yeah"],
  ["correct"],
  ["thats", "right"],
  ["thats", "correct"],
  ["ok"],
  ["okay"],
  ["verified"],
  ["looks", "good"],
  ["all", "good"],
];
const FILLERS: ReadonlySet<string> = new Set(["the", "a", "that", "thats", "this", "is", "its", "it", "and"]);
const MAX_CONFIRMATION_WORDS = 12;

function voiceTokens(transcript: string): string[] {
  return transcript
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function startsWith(tokens: readonly string[], at: number, phrase: readonly string[]): boolean {
  return phrase.every((word, i) => tokens[at + i] === word);
}

function isConfirmationOnly(transcript: string, step: LedgerStep): boolean {
  const tokens = voiceTokens(transcript);
  if (tokens.length === 0) return true;
  if (tokens.length > MAX_CONFIRMATION_WORDS) return false;
  const items = getExpectedObjects(step).map((label) => label.split(" "));
  let confirmed = false;
  let i = 0;
  while (i < tokens.length) {
    const confirmation = CONFIRMATIONS.find((phrase) => startsWith(tokens, i, phrase));
    if (confirmation) {
      confirmed = true;
      i += confirmation.length;
      continue;
    }
    const item = items.find((phrase) => startsWith(tokens, i, phrase));
    if (item) {
      i += item.length;
      continue;
    }
    if (FILLERS.has(tokens[i])) {
      i += 1;
      continue;
    }
    return false;
  }
  return confirmed;
}

// ---------------------------------------------------------------------------

function normalizeLabel(label: string): string {
  return normalizeText(label);
}

function countLabels(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = normalizeLabel(label);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Items in `a` not covered by `b`, respecting multiplicity. */
function difference(a: readonly string[], b: readonly string[]): string[] {
  const remaining = countLabels(b);
  const out: string[] = [];
  for (const [label, n] of Array.from(countLabels(a))) {
    const missing = n - (remaining.get(label) ?? 0);
    for (let i = 0; i < missing; i++) out.push(label);
  }
  return out;
}

function sameObjects(a: readonly string[], b: readonly string[]): boolean {
  return difference(a, b).length === 0 && difference(b, a).length === 0;
}

function block(reason: string): ReconcileResult {
  return { decision: "BLOCK", reason };
}

const MAX_OBJECTS = 100;

function isLabelList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_OBJECTS && value.every((v) => typeof v === "string");
}

/** null when the fields have the right types; otherwise the BLOCK reason. */
function invalidField(input: ReconcileInput): string | null {
  if (!isLabelList(input.sparkClaimedObjects)) return "Invalid input: sparkClaimedObjects must be a list of strings";
  if (!isLabelList(input.samDetectedObjects)) return "Invalid input: samDetectedObjects must be a list of strings";
  if (typeof input.voiceTranscript !== "string") return "Invalid input: voiceTranscript must be a string";
  if (typeof input.imageText !== "string") return "Invalid input: imageText must be a string";
  const confidence: unknown = input.samConfidence;
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return "Invalid input: samConfidence must be a number from 0 to 1";
  }
  return null;
}

function check(input: ReconcileInput): ReconcileResult {
  if (typeof input !== "object" || input === null) return block("Invalid input: missing");
  const { ledgerState } = input;

  if (!isLedgerState(ledgerState)) return block("Invalid ledger state");
  if (ledgerState.status === "COMPLETE") return block("Order already complete");

  const invalid = invalidField(input);
  if (invalid) return block(invalid);
  const { sparkClaimedObjects, samDetectedObjects, voiceTranscript, imageText } = input;

  const imageInjection = detectInjection(imageText);
  if (imageInjection.detected) {
    return block(`Injection attempt detected: image text ("${imageInjection.matched}")`);
  }
  const voiceInjection = detectInjection(voiceTranscript);
  if (voiceInjection.detected) {
    return block(`Injection attempt detected: voice transcript ("${voiceInjection.matched}")`);
  }
  // A command split across the sign and the voice ("please ship" + "it").
  const splitInjection = detectInjection(`${imageText} ${voiceTranscript}`);
  if (splitInjection.detected) {
    return block(`Injection attempt detected: image text + voice transcript ("${splitInjection.matched}")`);
  }

  const expected = getExpectedObjects(ledgerState.step);
  const missing = difference(expected, samDetectedObjects);
  if (missing.length > 0) {
    return block(`Perception mismatch: missing ${missing.join(", ")}`);
  }
  const unexpected = difference(samDetectedObjects, expected);
  if (unexpected.length > 0) {
    return block(`Perception mismatch: unexpected ${unexpected.join(", ")}`);
  }

  if (!sameObjects(sparkClaimedObjects, samDetectedObjects)) {
    return block("Reasoning does not match frame");
  }

  if (!isConfirmationOnly(voiceTranscript, ledgerState.step)) {
    return block("Voice contains an instruction, not a confirmation");
  }

  const allow = mintAllow(ledgerState);
  return {
    decision: "ALLOW",
    reason: `Verified ${ledgerState.step}`,
    nextState: advance(allow),
    allow,
  };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  try {
    return check(input);
  } catch {
    // Getters, proxies or a ledger error: never ALLOW on an exception.
    return block("Guard error: input could not be checked");
  }
}
