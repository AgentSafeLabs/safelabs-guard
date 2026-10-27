// Deterministic reconciliation of the ledger, Spark's claim, SAM's detections
// and the voice transcript. Pure TypeScript, never an LLM prompt.
// Only an ALLOW decision produces a nextState; BLOCK leaves the ledger as is.

import { detectInjection, normalizeText } from "./injections";
import { advance, getExpectedObjects, isLedgerState, type LedgerState } from "./ledger";

export type GuardVerdict = "ALLOW" | "BLOCK";

export interface ReconcileInput {
  ledgerState: LedgerState;
  sparkClaimedObjects: readonly string[];
  samDetectedObjects: readonly string[];
  voiceTranscript: string;
  imageText: string;
}

export interface ReconcileResult {
  decision: GuardVerdict;
  reason: string;
  nextState?: LedgerState;
}

// Transcripts that only confirm, with no instruction attached.
const SIMPLE_CONFIRMATIONS = new Set([
  "yes",
  "yep",
  "yeah",
  "ok",
  "okay",
  "confirm",
  "confirmed",
  "correct",
  "verified",
  "looks good",
  "all good",
  "that's correct",
  "yes confirmed",
]);

const INSTRUCTION_WORDS =
  /\b(?:approve|approved|ship|send|seal|skip|override|bypass|ignore|cancel|proceed|release|mark|change|update|add|remove|set|force)\b/;

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

function voiceIsInstruction(transcript: string): boolean {
  const normalized = normalizeText(transcript).replace(/[.!?,]+/g, "").trim();
  if (!normalized) return false;
  if (SIMPLE_CONFIRMATIONS.has(normalized)) return false;
  return INSTRUCTION_WORDS.test(normalized);
}

function block(reason: string): ReconcileResult {
  return { decision: "BLOCK", reason };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { ledgerState, sparkClaimedObjects, samDetectedObjects, voiceTranscript, imageText } = input;

  if (!isLedgerState(ledgerState)) return block("Invalid ledger state");
  if (ledgerState.status === "COMPLETE") return block("Order already complete");

  const imageInjection = detectInjection(imageText);
  if (imageInjection.detected) {
    return block(`Injection attempt detected: image text ("${imageInjection.matched}")`);
  }
  const voiceInjection = detectInjection(voiceTranscript);
  if (voiceInjection.detected) {
    return block(`Injection attempt detected: voice transcript ("${voiceInjection.matched}")`);
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

  if (voiceIsInstruction(voiceTranscript)) {
    return block("Voice contains an instruction, not a confirmation");
  }

  return {
    decision: "ALLOW",
    reason: `Verified ${ledgerState.step}`,
    nextState: advance(ledgerState),
  };
}
