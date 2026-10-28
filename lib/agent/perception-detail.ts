// Short, fixed explanations of why a perception source was unavailable.
// Only strings from this list ever reach a response or a block reason, so an
// upstream error body, a key or a key-bearing URL can never leak through one.

export const PERCEPTION_DETAILS = [
  "no frame sent",
  "no frame to read",
  "ocr rejected image",
  "ocr image too large",
  "ocr timeout",
  "ocr error",
  "vision not configured",
  "vision error",
  "sam not configured",
  "sam not live",
  "sam timeout",
  "sam error",
  "voice not sent",
  "voice not configured",
  "voice timeout",
  "voice error",
  "transcript not in English",
  "spark error",
  "spark not consulted: perception failed closed",
  "not consulted: perception failed closed",
] as const;

export type PerceptionDetail = (typeof PERCEPTION_DETAILS)[number];

const ALLOWED: ReadonlySet<string> = new Set<string>(PERCEPTION_DETAILS);

/** The detail itself when it is on the list; otherwise null. */
export function safeDetail(detail: string | null | undefined): PerceptionDetail | null {
  return detail && ALLOWED.has(detail) ? (detail as PerceptionDetail) : null;
}

/** "Timed out after ..." comes from describeError() in lib/meta/http.ts. */
export function isTimeout(error: string | null | undefined): boolean {
  return Boolean(error && error.startsWith("Timed out"));
}
