// Runs the headless PackProof agent through 4 scripted scenarios (normal, sign
// injection, spoken injection, wrong item), guarded and unguarded, on fakes
// only, and prints what actually happened.
//
// Usage:
//   npx tsx scripts/agent-demo.ts
//   npx tsx scripts/agent-demo.ts --probe-spark-image
//   npx tsx scripts/agent-demo.ts --ocr-file <path>
//
// --probe-spark-image makes live, billed Muse Spark calls (one /chat/completions
// call, then one /files upload and one /responses call) with a generated
// high-contrast PNG reading "KIWI 7310", to find out whether Spark reads
// image_url or input_image content parts. It prints the verdict and the first
// 200 characters of each reply, never headers or keys. Only the user runs this
// flag, with SAFELABS_USE_MOCKS=false and META_SPARK_API_KEY set in the
// environment; otherwise it makes no call. Tests never call it.
//
// --ocr-file runs the server OCR client (tesseract.js, local traineddata, no
// network) on a local PNG/JPEG/WebP and prints text, confidence and elapsed ms.

import { MockSamClient } from "../lib/meta/sam";
import { createSession, runTurn } from "../lib/agent/run";
import { naiveSpark, SCENARIOS } from "../lib/agent/scenarios";
import type { AgentMode, TurnRecord } from "../lib/agent/types";
import { readFile } from "node:fs/promises";
import { MockVisionClient, OcrVisionClient, probeSparkImageSupport } from "../lib/agent/vision";

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function firstStop(log: TurnRecord[]): TurnRecord | undefined {
  return log.find((r) => r.guard && r.guard.decision !== "ALLOW") ?? log.find((r) => r.executed === "SHIP");
}

async function demo(): Promise<void> {
  const cols: [string, number][] = [
    ["scenario", 17],
    ["mode", 10],
    ["executed", 34],
    ["shipped", 8],
    ["ledger", 16],
    ["first stop / ship", 64],
  ];
  const line = (cells: string[]) => cells.map((c, i) => pad(c, cols[i][1])).join(" ");
  console.log(line(cols.map(([name]) => name)));
  console.log(line(cols.map(([, w]) => "-".repeat(w))));

  for (const scenario of SCENARIOS) {
    for (const mode of ["unguarded", "guarded"] as AgentMode[]) {
      const session = createSession();
      const options = { mode, sam: new MockSamClient(), vision: new MockVisionClient(), reasoning: naiveSpark() };
      for (const observation of scenario.observations) await runTurn(session, observation, options);
      const stop = firstStop(session.log);
      const stopText = stop
        ? `t${stop.turn} ${stop.step}: ${stop.guard ? `${stop.guard.decision} ${stop.guard.reason}` : `${stop.executed} (no guard)`}`
        : "-";
      console.log(
        line([
          scenario.name,
          mode,
          session.log.map((r) => r.executed ?? "·").join(" "),
          session.shipped ? "YES" : "no",
          session.ledger.status === "COMPLETE" ? "COMPLETE" : session.ledger.step,
          stopText,
        ]),
      );
    }
  }
}

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Two runs on one client: the first includes worker start-up (cold), the second reuses it (warm). */
async function ocrFile(path: string): Promise<void> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const frameDataUrl = `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
  const ocr = new OcrVisionClient();
  try {
    for (const run of ["cold", "warm"]) {
      const started = performance.now();
      const result = await ocr.extract({ frameDataUrl, transcript: "" });
      const elapsed = Math.round(performance.now() - started);
      console.log(
        result.ok
          ? `${run}: ${elapsed} ms, confidence ${result.confidence}, text ${JSON.stringify(result.visibleText)}`
          : `${run}: ${elapsed} ms, failed: ${result.perceptionDetail}`,
      );
    }
  } finally {
    await ocr.close();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--probe-spark-image")) {
    for (const { part, verdict, reply } of await probeSparkImageSupport()) {
      console.log(`Spark ${part}: ${verdict}`);
      if (reply) console.log(`  reply (first 200 chars): ${JSON.stringify(reply)}`);
    }
    return;
  }
  const ocrIndex = process.argv.indexOf("--ocr-file");
  if (ocrIndex !== -1) {
    const path = process.argv[ocrIndex + 1];
    if (!path) throw new Error("--ocr-file needs a path");
    await ocrFile(path);
    return;
  }
  await demo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "agent demo failed");
  process.exit(1);
});
