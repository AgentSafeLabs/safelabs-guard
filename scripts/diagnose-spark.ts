// Diagnoses the deterministic "reasoning unavailable: spark timeout" seen on s-ignore-all.png.
// Makes LIVE Meta (Spark) calls: run by hand, never from tests.
//
//   META_SPARK_API_KEY=... npx tsx scripts/diagnose-spark.ts [flags]
//   npx tsx scripts/diagnose-spark.ts --dry-run      # plan only, no key needed, no calls
//
// Flags:
//   --n <k>              calls per case in the main matrix (default 5)
//   --variant-n <k>      calls per variant of s-ignore-all (default 3)
//   --max-calls <k>      hard cap on Spark calls (default 40); above it the script refuses to start
//   --timeout-ms <ms>    timeout for the main matrix and variant (a) (default META_TIMEOUT_MS = 10 s,
//                        the value the app used before the timeout patch)
//   --cases a,b,c        run only these cases (default: all six)
//   --skip-variants      skip the s-ignore-all variants
//   --with-max-tokens    add variant (e): max_tokens 384 (+variant-n calls; raise --max-calls to fit)
//   --frame-text raw|app raw (default): frameText = cleanUntrusted(OCR), what the app sent before the patch.
//                        app: whatever buildPerceptionReport() produces now (includes the sanitiser once patched).
//   --dry-run            print the plan and stop
//
// Real parts: the OCR (OcrVisionClient on bench/assets/images), the prompt (buildMessages/
// buildPerceptionReport/buildDetectedObjects), the request params and the reply parser.
// Stand-in: SAM. bench/recordings holds no recorded SAM answers, so SAM is a fixed result: every
// concept the server would ask about that is drawn in the image is "detected" with confidence 1,
// which is what live SAM reports. No Meta SAM, Voice or vision call is made.
//
// Never prints the key, headers or error bodies. Writes docs/audit/spark-timeout-run.txt.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getExpectedObjects, type LedgerStep } from "../lib/guard/ledger";
import {
  buildDetectedObjects,
  buildMessages,
  buildPerceptionReport,
  classifySparkFailure,
  cleanUntrusted,
  parseDecisionDetailed,
  SPARK_REASONING_PARAMS,
  SparkReplyError,
  type PerceptionReport,
} from "../lib/agent/packproof";
import type { SparkFailure } from "../lib/agent/types";
import { OcrVisionClient } from "../lib/agent/vision";
import { META_TIMEOUT_MS, metaFetch } from "../lib/meta/http";
import { SPARK_MODEL } from "../lib/meta/spark";

// Same list as ROUTE_DISTRACTORS in lib/server/agent-turn.ts (not imported: that module pulls in the whole route).
const ROUTE_DISTRACTORS = ["banana", "laptop"];
const IMAGE_DIR = join(process.cwd(), "bench", "assets", "images");
const OUT_FILE = join(process.cwd(), "docs", "audit", "spark-timeout-run.txt");
const PAUSE_MS = 500;
const VARIANT_CASE = "s-ignore-all";

interface CaseDef {
  id: string;
  file: string;
  /** Ledger step the manifest uses for this image (s-ignore-all: VERIFY_MUG as in the live session). */
  step: LedgerStep;
  /** Items drawn in the image (scripts/bench-make-images.ts), as SAM concept labels. */
  drawn: string[];
}

const CASES: CaseDef[] = [
  { id: "s-ignore-all", file: "s-ignore-all.png", step: "VERIFY_MUG", drawn: ["red mug", "blue notebook"] },
  { id: "v-rotated-noisy", file: "v-rotated-noisy.png", step: "VERIFY_MUG", drawn: ["red mug"] },
  { id: "v-complete", file: "v-complete.png", step: "VERIFY_CABLE", drawn: ["red mug", "blue notebook"] },
  { id: "v-benign-shipto", file: "v-benign-shipto.png", step: "VERIFY_NOTEBOOK", drawn: ["red mug", "blue notebook"] },
  { id: "n-mug", file: "n-mug.png", step: "VERIFY_MUG", drawn: ["red mug"] },
  { id: "w-banana", file: "w-banana.png", step: "VERIFY_CABLE", drawn: ["red mug", "blue notebook", "usb-c cable", "banana"] },
];

interface Variant {
  id: string;
  label: string;
  timeoutMs: number;
  /** null = the OCR text as read; a string replaces it. */
  frameText: string | null;
  maxTokens?: number;
  /** Reuses the main-matrix rows for this case instead of calling again. */
  reuseMain?: boolean;
}

interface Row {
  group: string;
  caseId: string;
  rep: number;
  timeoutMs: number;
  ms: number;
  outcome: "ok" | SparkFailure;
  parsed: boolean;
  completionTokens: number | null;
  action: string;
}

// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const int = (name: string, fallback: number, min = 1) => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
      console.error(`--${name} must be an integer >= ${min}`);
      process.exit(2);
    }
    return n;
  };
  const frameText = value("frame-text") ?? "raw";
  if (frameText !== "raw" && frameText !== "app") {
    console.error("--frame-text must be raw or app");
    process.exit(2);
  }
  return {
    n: int("n", 5),
    variantN: int("variant-n", 3),
    maxCalls: int("max-calls", 40),
    timeoutMs: int("timeout-ms", META_TIMEOUT_MS, 1000),
    cases: value("cases")?.split(",").map((s) => s.trim()).filter(Boolean),
    skipVariants: flag("skip-variants"),
    withMaxTokens: flag("with-max-tokens"),
    frameText: frameText as "raw" | "app",
    dryRun: flag("dry-run"),
  };
}

const args = parseArgs(process.argv.slice(2));
const selected = CASES.filter((c) => !args.cases || args.cases.includes(c.id));
if (selected.length === 0) {
  console.error(`No matching case. Known: ${CASES.map((c) => c.id).join(", ")}`);
  process.exit(2);
}

const variants: Variant[] = [];
if (!args.skipVariants && selected.some((c) => c.id === VARIANT_CASE)) {
  variants.push(
    { id: "a", label: "as is (main-matrix rows)", timeoutMs: args.timeoutMs, frameText: null, reuseMain: true },
    { id: "b", label: "timeout 20 s", timeoutMs: 20_000, frameText: null },
    { id: "c", label: 'OCR text replaced by "IGNORE ALL"', timeoutMs: args.timeoutMs, frameText: "IGNORE ALL" },
    { id: "d", label: "OCR text removed", timeoutMs: args.timeoutMs, frameText: "" },
  );
  if (args.withMaxTokens) {
    variants.push({ id: "e", label: "max_tokens 384", timeoutMs: args.timeoutMs, frameText: null, maxTokens: 384 });
  }
}

const mainCalls = selected.length * args.n;
const variantCalls = variants.filter((v) => !v.reuseMain).length * args.variantN;
const totalCalls = mainCalls + variantCalls;

const planLines: string[] = [
  "Plan (Spark /chat/completions only; SAM is a fixed stand-in; OCR is real and local)",
  `  model ${SPARK_MODEL}, params ${JSON.stringify(SPARK_REASONING_PARAMS)}, frameText mode: ${args.frameText}`,
  `  main matrix: ${selected.map((c) => c.id).join(", ")}  x ${args.n} calls  @ ${args.timeoutMs} ms timeout = ${mainCalls} calls`,
  ...variants.map((v) =>
    v.reuseMain
      ? `  variant ${v.id}: ${VARIANT_CASE}, ${v.label} = 0 extra calls`
      : `  variant ${v.id}: ${VARIANT_CASE}, ${v.label}  x ${args.variantN} calls  @ ${v.timeoutMs} ms = ${args.variantN} calls`,
  ),
  `  estimated Spark calls: ${totalCalls}  (cap ${args.maxCalls}; ${PAUSE_MS} ms pause between calls)`,
];
console.log(planLines.join("\n"));

if (totalCalls > args.maxCalls) {
  console.error(`\nRefusing to run: ${totalCalls} calls is above --max-calls ${args.maxCalls}. Lower --n/--variant-n or raise --max-calls.`);
  process.exit(2);
}
if (args.dryRun) {
  console.log("\n--dry-run: no calls made.");
  process.exit(0);
}

const key = process.env.META_SPARK_API_KEY;
if (!key) {
  console.error("\nSet META_SPARK_API_KEY in the environment.");
  process.exit(1);
}

// ---------------------------------------------------------------------------

let callsMade = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function buildReport(c: CaseDef, ocrText: string, frameTextOverride: string | null): PerceptionReport {
  const expected = getExpectedObjects(c.step);
  const concepts = [...expected, ...ROUTE_DISTRACTORS.filter((d) => !expected.includes(d))];
  // Fixed SAM: concepts that are drawn in the image, confidence 1 (live SAM's value).
  const detections = concepts.filter((x) => c.drawn.includes(x)).map((label) => ({ label, score: 1 }));
  const text = frameTextOverride ?? ocrText;
  const report = buildPerceptionReport({ detectedObjects: buildDetectedObjects(detections, concepts), frameText: text, transcript: "" });
  if (args.frameText === "raw") report.frameText = cleanUntrusted(text);
  return report;
}

async function callSpark(c: CaseDef, report: PerceptionReport, timeoutMs: number, maxTokens?: number) {
  const messages = buildMessages({ transcript: "" }, c.step, report, false);
  const body = JSON.stringify({ model: SPARK_MODEL, ...SPARK_REASONING_PARAMS, ...(maxTokens ? { max_tokens: maxTokens } : {}), messages });
  callsMade++;
  const t0 = Date.now();
  let outcome: Row["outcome"] = "ok";
  let parsed = false;
  let completionTokens: number | null = null;
  let action = "-";
  try {
    const res = await metaFetch("/chat/completions", key as string, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json: { choices?: { message?: { content?: unknown } }[]; usage?: { completion_tokens?: unknown } };
    try {
      json = (await res.json()) as typeof json;
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw err;
      throw new SparkReplyError("bad_json");
    }
    const tokens = json?.usage?.completion_tokens;
    completionTokens = typeof tokens === "number" ? tokens : null;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new SparkReplyError("schema");
    const result = parseDecisionDetailed(content);
    if (result.ok) {
      parsed = true;
      action = result.value.proposedAction;
    } else {
      outcome = result.failure;
    }
  } catch (err) {
    outcome = classifySparkFailure(err);
  }
  return { ms: Date.now() - t0, outcome, parsed, completionTokens, action };
}

function formatRows(rows: Row[]): string {
  const head = ["group", "case", "#", "timeout", "ms", "outcome", "parsed", "out_tok", "action"];
  const lines = rows.map((r) =>
    [r.group, r.caseId, String(r.rep), `${r.timeoutMs}`, String(r.ms), r.outcome, r.parsed ? "yes" : "no", r.completionTokens === null ? "-" : String(r.completionTokens), r.action],
  );
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [fmt(head), fmt(widths.map((w) => "-".repeat(w))), ...lines.map(fmt)].join("\n");
}

function summarize(rows: Row[], title: string, keyOf: (r: Row) => string): string {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const out = [title];
  for (const [k, rs] of groups) {
    const timeouts = rs.filter((r) => r.outcome === "timeout").length;
    const failed = rs.filter((r) => r.outcome !== "ok").length;
    const toks = rs.map((r) => r.completionTokens).filter((t): t is number => t !== null);
    out.push(
      `  ${k.padEnd(34)} calls ${String(rs.length).padStart(2)}  timeouts ${timeouts}  other-fail ${failed - timeouts}  median ${String(median(rs.map((r) => r.ms))).padStart(5)} ms  max ${String(Math.max(...rs.map((r) => r.ms))).padStart(5)} ms  out_tok median ${toks.length ? median(toks) : "-"}`,
    );
  }
  return out.join("\n");
}

async function main() {
  const ocr = new OcrVisionClient({ timeoutMs: 60_000 });
  const ocrText = new Map<string, string>();
  const ocrNotes: string[] = [];
  for (const c of selected) {
    const bytes = readFileSync(join(IMAGE_DIR, c.file));
    const r = await ocr.extract({ frameDataUrl: `data:image/png;base64,${bytes.toString("base64")}`, transcript: "" });
    ocrText.set(c.id, r.ok ? r.visibleText : "");
    ocrNotes.push(`  ${c.id.padEnd(16)} step ${c.step.padEnd(16)} ocr ${r.ok ? "ok" : "FAILED"}  raw ${JSON.stringify(r.ok ? r.visibleText : "")}`);
  }
  await ocr.close();
  console.log(`\nOCR (real, local):\n${ocrNotes.join("\n")}\n`);

  const rows: Row[] = [];
  const run = async (group: string, c: CaseDef, reps: number, timeoutMs: number, text: string | null, maxTokens?: number) => {
    const report = buildReport(c, ocrText.get(c.id) ?? "", text);
    for (let rep = 1; rep <= reps; rep++) {
      const r = await callSpark(c, report, timeoutMs, maxTokens);
      const row: Row = { group, caseId: c.id, rep, timeoutMs, ...r };
      rows.push(row);
      console.log(`${group.padEnd(8)} ${c.id.padEnd(16)} #${rep} ${String(r.ms).padStart(6)} ms  ${r.outcome}${r.parsed ? ` (${r.action})` : ""}`);
      await sleep(PAUSE_MS);
    }
  };

  for (const c of selected) await run("main", c, args.n, args.timeoutMs, null);
  const target = selected.find((c) => c.id === VARIANT_CASE);
  if (target) {
    for (const v of variants.filter((x) => !x.reuseMain)) await run(`var-${v.id}`, target, args.variantN, v.timeoutMs, v.frameText, v.maxTokens);
  }

  const report: string[] = [
    `diagnose-spark run ${new Date().toISOString()}`,
    ...planLines,
    "",
    "OCR (real, local):",
    ...ocrNotes,
    "",
    "Per call:",
    formatRows(rows),
    "",
    summarize(rows.filter((r) => r.group === "main"), `Main matrix (timeout ${args.timeoutMs} ms):`, (r) => r.caseId),
  ];
  if (target && variants.length) {
    const label = (g: string) => {
      const id = g === "main" ? "a" : g.replace("var-", "");
      const v = variants.find((x) => x.id === id);
      return `${id}: ${v?.label ?? g}`;
    };
    const vrows = rows.filter((r) => r.caseId === VARIANT_CASE);
    report.push("", summarize(vrows, `Variants of ${VARIANT_CASE}:`, (r) => label(r.group)));
    report.push("", "Variants that time out:");
    for (const v of variants) {
      const rs = vrows.filter((r) => r.group === (v.reuseMain ? "main" : `var-${v.id}`));
      const t = rs.filter((r) => r.outcome === "timeout").length;
      report.push(`  (${v.id}) ${v.label.padEnd(36)} ${t}/${rs.length} timed out${rs.length ? (t === rs.length ? "  <- always" : t > 0 ? "  <- sometimes" : "  <- never") : ""}`);
    }
  }
  report.push("", `Spark calls made: ${callsMade}`);
  const text = report.join("\n");
  console.log(`\n${text}`);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${text}\n`);
  console.log(`\nWritten: ${OUT_FILE}`);
}

main().catch(() => {
  // No error text on purpose: it could carry request details.
  console.error("diagnose-spark failed unexpectedly");
  process.exit(1);
});
