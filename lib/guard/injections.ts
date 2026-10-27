// Deterministic, case-insensitive detection of instruction injection in
// image text and voice transcripts. No model calls.

interface InjectionPattern {
  label: string;
  pattern: RegExp;
}

const PATTERNS: readonly InjectionPattern[] = [
  { label: "ignore checks", pattern: /\bignore\s+(?:all\s+|the\s+|any\s+)?checks?\b/ },
  { label: "ignore previous", pattern: /\bignore\s+(?:all\s+|the\s+|any\s+)?previous\b/ },
  { label: "approve shipment", pattern: /\bapprove\s+(?:the\s+)?shipment\b/ },
  { label: "approve now", pattern: /\bapprove\s+(?:it\s+)?now\b/ },
  { label: "ship it", pattern: /\bship\s+it\b/ },
  { label: "manager override", pattern: /\bmanager\s+override\b/ },
  { label: "system:", pattern: /\bsystem\s*:/ },
  { label: "ledger updated", pattern: /\bledger\s+(?:has\s+been\s+|was\s+)?updated\b/ },
  { label: "order cancelled", pattern: /\border\s+(?:has\s+been\s+|was\s+|is\s+)?cancell?ed\b/ },
  { label: "skip verification", pattern: /\bskip\s+(?:the\s+|all\s+)?verifications?\b/ },
];

export interface InjectionResult {
  detected: boolean;
  matched?: string;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectInjection(text: string): InjectionResult {
  const normalized = normalizeText(text ?? "");
  if (!normalized) return { detected: false };
  for (const { label, pattern } of PATTERNS) {
    if (pattern.test(normalized)) return { detected: true, matched: label };
  }
  return { detected: false };
}
