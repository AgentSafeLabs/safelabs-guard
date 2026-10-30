// Display-only classification of OCR text for the result card. It decides
// whether the text is worth showing as a headline or belongs under Details.
// Nothing here is imported by the guard, the detector or the API: they always
// receive the raw text (a test checks the imports).

export type OcrKind = "none" | "readable" | "noisy";

export interface OcrDisplay {
  kind: OcrKind;
  /** Whitespace-collapsed text; empty when kind is "none". */
  display: string;
}

/** Texts with fewer tokens than this are never called noisy (too little to judge). */
export const MIN_TOKENS = 4;
/** Share of tokens with 2 or fewer letters/digits at which the text is noisy. */
export const SHORT_TOKEN_SHARE = 0.5;
/** Share of non-space characters that are not letters or digits. */
export const SYMBOL_SHARE = 0.3;
/** Fewer word-like tokens than this share is noisy. */
export const MIN_WORD_SHARE = 0.4;
/** Share of tokens with a lower-to-upper case switch ("nT", "dL"), when words are also scarce. */
export const ODD_CASE_SHARE = 0.2;
export const ODD_CASE_WORD_SHARE = 0.6;

/** Short words and numbers are neutral: they neither make text readable nor noisy. */
const SMALL_WORDS: ReadonlySet<string> = new Set(
  ["a", "i", "am", "an", "as", "at", "be", "by", "do", "go", "if", "in", "is", "it", "me", "my", "no", "of", "ok", "on", "or", "so", "to", "up", "us", "we"],
);

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const LOWER_THEN_UPPER = /\p{Ll}\p{Lu}/u;

function core(token: string): string {
  return token.replace(EDGE, "");
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

/** A token that reads like a word or a code: 3+ letters (or 3+ digits), no case switch. */
function isWordLike(c: string): boolean {
  if (/^\d{3,}$/.test(c)) return true;
  return letterCount(c) >= 3 && /^[\p{L}\p{N}'’-]+$/u.test(c) && !LOWER_THEN_UPPER.test(c);
}

export function classifyOcrText(raw: string): OcrDisplay {
  const display = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(display)) return { kind: "none", display: "" };

  const tokens = display.split(" ");
  const n = tokens.length;
  if (n < MIN_TOKENS) return { kind: "readable", display };

  // Codes of 3+ digits count as word-like; shorter numbers and small words are skipped.
  const cores = tokens.map(core).filter((c) => /^\d{3,}$/.test(c) || !(SMALL_WORDS.has(c.toLowerCase()) || /^\d+$/.test(c)));
  const m = cores.length;
  if (m === 0) return { kind: "readable", display };
  const short = cores.filter((c) => c.length <= 2).length / m;
  const words = cores.filter(isWordLike).length / m;
  const odd = cores.filter((c) => LOWER_THEN_UPPER.test(c)).length / m;
  const chars = display.replace(/ /g, "");
  const symbols = (chars.match(/[^\p{L}\p{N}]/gu) ?? []).length / chars.length;

  const noisy =
    short >= SHORT_TOKEN_SHARE ||
    symbols >= SYMBOL_SHARE ||
    words < MIN_WORD_SHARE ||
    (odd >= ODD_CASE_SHARE && words < ODD_CASE_WORD_SHARE);
  return { kind: noisy ? "noisy" : "readable", display };
}
