// Tier-2 media benchmark CLI.
//   npm run bench:replay      replay bench/recordings (no keys, no network)
//   npm run bench:record      record missing answers live, then write results
//   npm run bench:live-plan   print the live calls a record run would make
// Options: --max-calls N (default 400) caps a record or live run.
//          --only <caseId> runs one case; no results files are written.
// Env (record and live runs): SAFELABS_BENCH_TIMEOUT_MS per-call timeout (unset
// keeps each client's own), SAFELABS_BENCH_RETRIES retries on timeout/5xx/429
// (default 2, record runs only). Replay is offline and never retries.
// Keys come only from the environment and are never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NAIVE_SYSTEM_PROMPT } from "../bench/agents/naive";
import { SparkReasoningClient } from "../lib/agent/packproof";
import { OcrVisionClient } from "../lib/agent/vision";
import { benchRetries, benchTimeoutMs, LiveCallRunner } from "../lib/bench/live-calls";
import { validateManifest, type Manifest } from "../lib/bench/manifest";
import { benchMode, Recorder } from "../lib/bench/recorder";
import { renderResultsMarkdown } from "../lib/bench/report";
import { BenchRunner, estimateLiveCalls, type SparkLike } from "../lib/bench/runner";
import { formatRate } from "../lib/bench/stats";
import { LiveSamClient, type SamClient } from "../lib/meta/sam";
import { LiveVoiceClient, type VoiceClient } from "../lib/meta/voice";

const BENCH_DIR = join(process.cwd(), "bench");
const DEFAULT_MAX_CALLS = 400;

function fail(message: string): never {
  console.error(`bench: ${message}`);
  process.exit(1);
}

function maxCalls(argv: string[]): number {
  const i = argv.indexOf("--max-calls");
  if (i < 0) return DEFAULT_MAX_CALLS;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) fail("--max-calls needs a whole number");
  return n;
}

function onlyCase(argv: string[], manifest: Manifest): Manifest {
  const i = argv.indexOf("--only");
  if (i < 0) return manifest;
  const id = argv[i + 1];
  const found = manifest.cases.filter((c) => c.id === id);
  if (!id || found.length === 0) fail(`--only needs a case id from the manifest (${manifest.cases.map((c) => c.id).join(", ")})`);
  return { ...manifest, cases: found };
}

function key(name: "META_SAM_API_KEY" | "META_SPARK_API_KEY" | "META_VOICE_API_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set. Live calls need it; nothing was called.`);
  return value;
}

const noLive = (what: string) => () => {
  throw new Error(`${what}: no live calls in replay mode`);
};

async function main() {
  const argv = process.argv.slice(2);
  const plan = argv.includes("--plan");
  const mode = plan ? "replay" : benchMode();

  const manifestText = readFileSync(join(BENCH_DIR, "manifest.json"), "utf8");
  const fullManifest = validateManifest(JSON.parse(manifestText), (p) => existsSync(join(BENCH_DIR, p)));
  const manifest = onlyCase(argv, fullManifest);
  const partial = manifest.cases.length !== fullManifest.cases.length;
  let timeoutMs: number | undefined;
  let retries: number;
  try {
    timeoutMs = benchTimeoutMs();
    retries = benchRetries();
  } catch (err) {
    fail(err instanceof Error ? err.message : "bad bench environment");
  }
  const live = new LiveCallRunner({
    timeoutMs,
    retries: mode === "record" ? retries : 0,
    log: mode === "replay" ? undefined : (line) => console.log(line),
  });
  const recorder = new Recorder({ mode, dir: join(BENCH_DIR, "recordings"), live });

  const estimate = estimateLiveCalls(manifest, recorder, BENCH_DIR);
  const estimateText =
    `${estimate.total} live calls at most (SAM ${estimate.sam} HTTP requests, Voice ${estimate.voice}, ` +
    `Spark reasoning ≤${estimate.spark}) for ${manifest.cases.length} cases`;
  if (plan) {
    console.log(`bench:live-plan: ${estimateText}.`);
    console.log("Recordings already on disk are reused and not counted (Spark is an upper bound: it is not checked).");
    console.log(`A record run refuses above --max-calls (default ${DEFAULT_MAX_CALLS}).`);
    return;
  }

  let spark: { prompted: SparkLike; naive: SparkLike };
  let liveSam: () => SamClient = noLive("SAM");
  let liveVoice: () => VoiceClient = noLive("Voice");
  if (mode === "replay") {
    const stub = { complete: noLive("Spark") };
    const prompted = new SparkReasoningClient();
    const naive = new SparkReasoningClient({ systemPrompt: NAIVE_SYSTEM_PROMPT });
    spark = {
      prompted: { messagesFor: (r) => prompted.messagesFor(r), complete: stub.complete },
      naive: { messagesFor: (r) => naive.messagesFor(r), complete: stub.complete },
    };
  } else {
    const cap = maxCalls(argv);
    console.log(`bench (${mode}): ${estimateText}.`);
    console.log(
      `Per-call timeout: ${timeoutMs === undefined ? "client default" : `${timeoutMs}ms`}; retries: ${mode === "record" ? retries : 0}.`,
    );
    if (estimate.total > cap) fail(`estimate ${estimate.total} is above --max-calls ${cap}. Nothing was called.`);
    // Fail closed: every key a call may need must be present before any call.
    const samKey = estimate.sam > 0 || mode === "live" ? key("META_SAM_API_KEY") : "";
    const voiceKey = estimate.voice > 0 || (mode === "live" && manifest.cases.some((c) => c.audio)) ? key("META_VOICE_API_KEY") : "";
    const sparkKey = key("META_SPARK_API_KEY");
    liveSam = () => new LiveSamClient(samKey, { timeoutMs });
    liveVoice = () => new LiveVoiceClient(voiceKey, { timeoutMs });
    spark = {
      prompted: new SparkReasoningClient({ apiKey: sparkKey }),
      naive: new SparkReasoningClient({ apiKey: sparkKey, systemPrompt: NAIVE_SYSTEM_PROMPT }),
    };
  }

  const ocrClient = new OcrVisionClient({ timeoutMs: 60_000 });
  const runner = new BenchRunner({
    recorder,
    benchDir: BENCH_DIR,
    ocr: async (image) => {
      const r = await ocrClient.extract({ frameDataUrl: image.dataUrl, transcript: "" });
      return { ok: r.ok, text: r.ok ? r.visibleText : "" };
    },
    liveSam,
    liveVoice,
    spark,
  });

  let results;
  try {
    results = await runner.run(manifest, manifestText);
  } catch (err) {
    if (mode !== "replay") for (const line of live.summaryLines()) console.error(line);
    fail(err instanceof Error ? err.message : "run failed");
  } finally {
    await ocrClient.close();
  }

  const json = `${JSON.stringify(results, null, 2)}\n`;
  if (partial) {
    // One case is not the benchmark: never overwrite the full results with it.
  } else if (mode === "live") {
    mkdirSync(join(BENCH_DIR, "results"), { recursive: true });
    writeFileSync(join(BENCH_DIR, "results", "live.json"), json);
  } else {
    mkdirSync(join(BENCH_DIR, "results"), { recursive: true });
    writeFileSync(join(BENCH_DIR, "results", "latest.json"), json);
    writeFileSync(join(BENCH_DIR, "RESULTS.md"), renderResultsMarkdown(results));
  }

  if (mode !== "replay") {
    console.log(`Live calls made: ${recorder.liveCalls}.`);
    for (const line of live.summaryLines()) console.log(line);
  }
  for (const split of ["dev", "heldout", "real"] as const) {
    const s = results.summary[split];
    if (!s.cases) continue;
    console.log(`\n${split} (${s.cases} cases)`);
    for (const [agent, m] of Object.entries(s.agents)) {
      console.log(`  ${agent.padEnd(19)} attack success ${formatRate(m.attackSuccess)}; false block ${formatRate(m.falseBlock)}`);
    }
  }
  if (partial) console.log("\nPartial run (--only): results files were not written.");
  else console.log(mode === "live" ? "\nWrote bench/results/live.json" : "\nWrote bench/results/latest.json and bench/RESULTS.md");
}

main().catch((err) => fail(err instanceof Error ? err.message : "failed"));
