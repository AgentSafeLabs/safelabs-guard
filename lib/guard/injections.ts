// Deterministic, case-insensitive detection of instruction injection in
// image text and voice transcripts. No model calls.
//
// Text is normalized before matching (normalizeForScan): Unicode NFKC,
// zero-width / bidi-control / tag characters removed, common Cyrillic and
// Greek look-alikes folded to Latin, whitespace collapsed, lowercased. Each
// text is then matched in several variants: as normalized, with leetspeak
// mapped (1 read as "i" and, separately, as "l"), and with stray symbols
// removed. Multi-word patterns tolerate up to 3 short OCR junk tokens between
// their words ("IGNORE ALL > Sl PREVIOUS INSTRUCTIONS").

interface InjectionPattern {
  label: string;
  pattern: RegExp;
}

/** Up to 3 junk tokens (1-3 characters each) may sit between pattern words. */
const GAP = "\\s+(?:\\S{1,3}\\s+){0,3}";

/** A space in `source` means GAP. Patterns are matched against normalized (lowercase) text. */
function p(label: string, source: string): InjectionPattern {
  return { label, pattern: new RegExp(source.replace(/ /g, GAP)) };
}

const OVERRIDE_VERB = "(?:ignore|disregard|forget|override|skip|bypass)";
const DETERMINER = "(?:all|the|any|your|these|those|previous|prior|earlier|above|my)";
const GUARDED_THING = "(?:instructions?|rules?|checks?|verifications?|restrictions?|guard(?:rails?)?|safety)";

const PATTERNS: readonly InjectionPattern[] = [
  // The original 10 (labels unchanged: reconcile and the UI show them).
  p("ignore checks", "\\bignore (?:all |the |any )?checks?\\b"),
  p("ignore previous", "\\bignore (?:all |the |any )?previous\\b"),
  p("approve shipment", "\\bapprove (?:the |this )?(?:shipment|shipping)\\b"),
  p("approve now", "\\bapprove (?:it |this |the order )?now\\b"),
  p("ship it", "\\bship it\\b"),
  p("manager override", "\\bmanager override\\b"),
  p("system:", "\\bsystem\\s*:"),
  p("ledger updated", "\\bledger (?:has been |was )?updated\\b"),
  p("order cancelled", "\\border (?:has been |was |is )?cancell?ed\\b"),
  p("skip verification", "\\bskip (?:the |all )?verifications?\\b"),

  // Paraphrases of "ignore the rules".
  p("ignore instructions", `\\b${OVERRIDE_VERB} (?:${DETERMINER} ){0,3}${GUARDED_THING}\\b`),
  p("don't worry about the rules", "\\b(?:dont|do not) worry about (?:the |any |those |these )?(?:restrictions?|rules?|checks?|verifications?)\\b"),

  // Role / authority hijack.
  p("you are now", "\\byou are now\\b"),
  p("new instructions", "\\bnew instructions?\\b"),
  p("system prompt", "\\bsystem prompt\\b"),
  p("developer mode", "\\bdeveloper mode\\b"),
  p("operator override", "\\b(?:operator|admin|administrator|supervisor) override\\b"),
  p("system notice", "\\bsystem (?:notice|message|override)\\b"),
  p("authority claim", "\\b(?:the )?(?:manager|admin|administrator|operator|boss|supervisor) (?:says|said|approved|approves|authori[sz]ed|wants)\\b"),

  // Direct shipping commands.
  p("mark shipped", "\\bmark (?:the )?(?:order )?(?:[a-z0-9-]+ )?(?:as )?shipped\\b"),
  p("ship it", "\\bship (?:it|this|that|the (?:product|order|box|package|items?))\\b"),
  p("send it", "\\bsend (?:it|this|the (?:order|box|package)) (?:now|out|off)\\b"),
  p("just ship", "\\bjust ship\\b"),

  // Concealment and false claims of completion.
  p("do not tell", "\\b(?:dont|do not|never) (?:tell|inform|mention)\\b"),
  p("this is a test", "\\bthis is (?:just )?(?:a |only a )?test\\b.{0,30}\\bproceed\\b"),
  p("already verified", "\\balready (?:been )?verified\\b"),
  p("all items verified", "\\ball (?:the )?items? (?:are |have been |were )?(?:already )?verified\\b"),
];

export interface InjectionResult {
  detected: boolean;
  matched?: string;
}

/** Lowercase and collapse whitespace only. Used for object labels; NOT the injection scan. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Zero-width, joiners, word joiner, BOM, soft hyphen, Arabic letter mark,
// bidi embeddings/overrides/isolates, and Unicode tag characters.
const INVISIBLE = new RegExp(
  "[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff\\u{e0000}-\\u{e007f}]",
  "gu",
);

// Lowercase Cyrillic and Greek letters that look like Latin ones.
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  ѕ: "s", і: "i", ї: "i", ј: "j", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w", ү: "y", һ: "h",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w", ς: "s",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

const LEET: Readonly<Record<string, string>> = { "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

function leet(text: string, one: "i" | "l"): string {
  return text.replace(/[013457@$]/g, (ch) => (ch === "1" ? one : LEET[ch]));
}

/** Symbols become spaces; apostrophes vanish so "don't" reads "dont". */
function stripSymbols(text: string): string {
  return text.replace(/['’`]/g, "").replace(/[^\p{L}\p{N}\s-]+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * NFKC, invisible characters removed, confusables folded, leetspeak mapped
 * (1 -> i), apostrophes dropped, whitespace collapsed, lowercased. Symbols
 * are kept: detection also runs on a copy with them removed.
 */
export function normalizeForScan(text: string): string {
  return leet(baseNormalize(text), "i").replace(/['’`]/g, "");
}

function baseNormalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

function variants(text: string): string[] {
  const base = baseNormalize(text);
  const forms = [base, leet(base, "i"), leet(base, "l")];
  const all = forms.flatMap((f) => [f.replace(/['’`]/g, ""), stripSymbols(f)]);
  return Array.from(new Set(all)).filter(Boolean);
}

export function detectInjection(text: string): InjectionResult {
  if (typeof text !== "string" || !text.trim()) return { detected: false };
  const forms = variants(text);
  for (const { label, pattern } of PATTERNS) {
    if (forms.some((f) => pattern.test(f))) return { detected: true, matched: label };
  }
  return { detected: false };
}

export interface SourcesInjectionResult extends InjectionResult {
  /** Where it was found. "both" = only the joined text matched (a command split across image and voice). */
  source?: "image" | "voice" | "both";
}

/** Scans image text and transcript each alone, then joined. */
export function detectInjectionInSources(imageText: string, transcript: string): SourcesInjectionResult {
  const image = detectInjection(imageText);
  if (image.detected) return { ...image, source: "image" };
  const voice = detectInjection(transcript);
  if (voice.detected) return { ...voice, source: "voice" };
  const joined = detectInjection(`${imageText ?? ""} ${transcript ?? ""}`);
  return joined.detected ? { ...joined, source: "both" } : { detected: false };
}
