// Tier-2 benchmark case manifest (bench/manifest.json) and its validator.
// Hand-written checks, no schema library. Media paths are relative to bench/.

import { STEPS, type LedgerStep } from "../guard/ledger";

export const CATEGORIES = [
  "normal",
  "wrong_item",
  "visual_injection",
  "audio_injection",
  "split_injection",
  "replayed_frame",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SPLITS = ["dev", "heldout"] as const;
export type Split = (typeof SPLITS)[number];

/** ALLOW: the right behaviour is the step's legal action. BLOCK: nothing may run. */
export type ExpectedOutcome = "ALLOW" | "BLOCK";

export interface BenchCase {
  id: string;
  category: Category;
  split: Split;
  step: LedgerStep;
  /** Relative to bench/, e.g. "assets/images/n-mug.png". */
  image: string;
  /** Relative to bench/, a mono 16 kHz WAV. */
  audio?: string;
  expected: ExpectedOutcome;
  /** Ground truth: the frame text or speech tries to instruct the agent. */
  injection: boolean;
  notes: string;
  /** A real photo or recording, reported separately. */
  real?: boolean;
}

export interface Manifest {
  version: 1;
  cases: BenchCase[];
}

const CASE_KEYS = new Set(["id", "category", "split", "step", "image", "audio", "expected", "injection", "notes", "real"]);
const ID = /^[A-Z][A-Z0-9-]{1,23}$/;
const IMAGE = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|jpe?g|webp)$/;
const AUDIO = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.wav$/;

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid bench manifest:\n- ${problems.join("\n- ")}`);
    this.name = "ManifestError";
  }
}

function isMediaPath(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value) && !value.split("/").includes("..");
}

function checkCase(raw: unknown, at: string, problems: string[]): BenchCase | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push(`${at}: must be an object`);
    return null;
  }
  const c = raw as Record<string, unknown>;
  const before = problems.length;
  for (const key of Object.keys(c)) if (!CASE_KEYS.has(key)) problems.push(`${at}: unknown field "${key}"`);
  if (typeof c.id !== "string" || !ID.test(c.id)) problems.push(`${at}: id must match ${ID}`);
  if (!(CATEGORIES as readonly unknown[]).includes(c.category)) problems.push(`${at}: category must be one of ${CATEGORIES.join(", ")}`);
  if (!(SPLITS as readonly unknown[]).includes(c.split)) problems.push(`${at}: split must be "dev" or "heldout"`);
  if (!(STEPS as readonly unknown[]).includes(c.step)) problems.push(`${at}: step must be one of ${STEPS.join(", ")}`);
  if (!isMediaPath(c.image, IMAGE)) problems.push(`${at}: image must be a .png/.jpg/.webp path under assets/`);
  if (c.audio !== undefined && !isMediaPath(c.audio, AUDIO)) problems.push(`${at}: audio must be a .wav path under assets/`);
  if (c.expected !== "ALLOW" && c.expected !== "BLOCK") problems.push(`${at}: expected must be "ALLOW" or "BLOCK"`);
  if (typeof c.injection !== "boolean") problems.push(`${at}: injection must be true or false`);
  if (typeof c.notes !== "string" || !c.notes.trim()) problems.push(`${at}: notes must be a non-empty string`);
  if (c.real !== undefined && typeof c.real !== "boolean") problems.push(`${at}: real must be true or false`);
  if (c.category === "normal" && c.expected !== "ALLOW") problems.push(`${at}: a normal case must expect ALLOW`);
  if (c.category === "normal" && c.injection === true) problems.push(`${at}: a normal case cannot be an injection`);
  if (problems.length > before) return null;
  return c as unknown as BenchCase;
}

/**
 * Throws ManifestError listing every problem. `exists`, when given, is asked
 * about each media path (relative to bench/).
 */
export function validateManifest(raw: unknown, exists?: (path: string) => boolean): Manifest {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ManifestError(["manifest must be an object"]);
  const m = raw as Record<string, unknown>;
  for (const key of Object.keys(m)) if (key !== "version" && key !== "cases") problems.push(`unknown top-level field "${key}"`);
  if (m.version !== 1) problems.push("version must be 1");
  if (!Array.isArray(m.cases) || m.cases.length === 0) {
    problems.push("cases must be a non-empty array");
    throw new ManifestError(problems);
  }
  const cases: BenchCase[] = [];
  const ids = new Set<string>();
  m.cases.forEach((raw, i) => {
    const c = checkCase(raw, `cases[${i}]`, problems);
    if (!c) return;
    if (ids.has(c.id)) problems.push(`cases[${i}]: duplicate id ${c.id}`);
    ids.add(c.id);
    if (exists) {
      if (!exists(c.image)) problems.push(`${c.id}: image not found: ${c.image}`);
      if (c.audio && !exists(c.audio)) problems.push(`${c.id}: audio not found: ${c.audio}`);
    }
    cases.push(c);
  });
  if (problems.length) throw new ManifestError(problems);
  return { version: 1, cases };
}
