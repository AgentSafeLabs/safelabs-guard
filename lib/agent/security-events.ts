// Display-only injection scan over a turn's image text and transcript.
// Uses the same deterministic detector as reconcile() (lib/guard/injections.ts)
// but never feeds a decision: guarded turns keep whatever the gate decided
// (HOLD stays HOLD), and unguarded turns are scanned only after the agent's
// action is fixed ("shadow" events).

import { detectInjection } from "../guard/injections";
import { redact } from "./redact";
import { cleanOcrText } from "./vision";

export const EXCERPT_MAX = 80;
export const SHADOW_LABEL = "shadow: the guard would have flagged this";

export interface SecurityEvent {
  kind: "injection";
  source: "image" | "voice" | "both";
  /** At most EXCERPT_MAX characters, control characters stripped. */
  excerpt: string;
  /** true in unguarded mode: computed after the action, for display only. */
  shadow: boolean;
  label?: typeof SHADOW_LABEL;
}

/** Control and format characters stripped, whitespace collapsed, capped at EXCERPT_MAX. */
export function cleanExcerpt(text: string): string {
  return Array.from(redact(cleanOcrText(text))).slice(0, EXCERPT_MAX).join("");
}

/**
 * Text around the match. The detector reports only a label, so this finds the
 * last start offset whose suffix still matches (binary search) and keeps a
 * little context before it.
 */
function excerptAround(text: string): string {
  const clean = cleanOcrText(text);
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (detectInjection(clean.slice(mid)).detected) lo = mid;
    else hi = mid - 1;
  }
  const start = Math.max(0, lo - 20);
  return cleanExcerpt(clean.slice(start, start + EXCERPT_MAX * 2));
}

export interface ScanInput {
  imageText: string;
  transcript: string;
}

/**
 * Scans image text, transcript, and both joined. A "both" event is reported
 * only when the joined text matches and neither part does on its own (an
 * instruction split between the sign and the voice).
 */
export function scanForInjection(input: ScanInput, shadow: boolean): SecurityEvent[] {
  const event = (source: SecurityEvent["source"], text: string): SecurityEvent => ({
    kind: "injection",
    source,
    excerpt: excerptAround(text),
    shadow,
    ...(shadow ? { label: SHADOW_LABEL } : {}),
  });
  const events: SecurityEvent[] = [];
  const image = detectInjection(input.imageText).detected;
  const voice = detectInjection(input.transcript).detected;
  if (image) events.push(event("image", input.imageText));
  if (voice) events.push(event("voice", input.transcript));
  if (!image && !voice) {
    const joined = `${input.imageText} ${input.transcript}`;
    if (detectInjection(joined).detected) events.push(event("both", joined));
  }
  return events;
}
