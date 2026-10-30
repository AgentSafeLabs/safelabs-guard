// Pure display text for the PackProof turn card. No DOM, so it is unit-tested.

import type { SecurityEvent } from "../agent/security-events";
import type { TurnRecord } from "../agent/types";
import type { SourceLabel } from "../server/agent-turn";

/** True for the fixed details that mean the source was never asked (the turn was stopped before perception ran). */
export function isNotConsulted(detail: string | null | undefined): boolean {
  return Boolean(detail && detail.includes("not consulted"));
}

/**
 * "VOICE: NOT SENT" when no clip went out, "SAM: NOT CONSULTED" when the turn was
 * blocked before that source ran; otherwise the server's label ("UNAVAILABLE"
 * means the source was tried and failed).
 */
export function sourceBadgeText(name: string, source: SourceLabel, opts: { notSent?: boolean; notConsulted?: boolean } = {}): string {
  const label = opts.notSent ? "not sent" : opts.notConsulted ? "not consulted" : source;
  return `${name}: ${label}`.toUpperCase();
}

/** Labels image text by whether it was really read (live), mocked, or not read at all. */
export function imageTextLabel(source: SourceLabel): string {
  return `Image text (${source})`;
}

const FAIL_CLOSED: readonly [prefix: string, text: string][] = [
  ["image text unavailable", "The guard blocked this because it could not read the image. This is the safe default."],
  ["SAM unavailable", "The guard blocked this because it could not check the objects in the frame. This is the safe default."],
  ["SAM not live", "The guard blocked this because it could not check the objects in the frame. This is the safe default."],
  ["voice unavailable", "The guard blocked this because it could not understand the voice clip. This is the safe default."],
];

/** Plain-language line when a guarded turn BLOCKed because perception failed closed; null otherwise. */
export function failClosedExplanation(guard: TurnRecord["guard"]): string | null {
  if (!guard || guard.decision !== "BLOCK") return null;
  return FAIL_CLOSED.find(([prefix]) => guard.reason.startsWith(prefix))?.[1] ?? null;
}

/** Banner for the turn card, shown whatever the decision (HOLD included); null when nothing was detected. */
export function injectionBanner(events: readonly SecurityEvent[] | undefined): string | null {
  if (!events || events.length === 0) return null;
  const image = events.some((e) => e.source === "image" || e.source === "both");
  const voice = events.some((e) => e.source === "voice" || e.source === "both");
  const where = image && voice ? "image text and voice" : image ? "image text" : "voice";
  const text = `Guard detected an injection attempt in ${where}`;
  return events.some((e) => e.shadow) ? `${text} (shadow: the guard would have flagged this)` : text;
}
