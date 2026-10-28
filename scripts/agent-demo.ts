// Runs the headless PackProof agent through 4 scripted scenarios (normal, sign
// injection, spoken injection, wrong item), guarded and unguarded, on fakes
// only, and prints what actually happened.
//
// Usage:
//   npx tsx scripts/agent-demo.ts
//   npx tsx scripts/agent-demo.ts --probe-spark-image
//
// --probe-spark-image makes ONE live, billed Muse Spark call with a generated
// 16x16 PNG to find out whether Spark accepts image_url content parts. Only
// the user runs this flag, with SAFELABS_USE_MOCKS=false and
// META_SPARK_API_KEY set in the environment. Tests never call it.

import { MockSamClient } from "../lib/meta/sam";
import { createSession, runTurn } from "../lib/agent/run";
import { naiveSpark, SCENARIOS } from "../lib/agent/scenarios";
import type { AgentMode, TurnRecord } from "../lib/agent/types";
import { MockVisionClient, probeSparkImageSupport } from "../lib/agent/vision";

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

async function main(): Promise<void> {
  if (process.argv.includes("--probe-spark-image")) {
    console.log(`Spark image support: ${await probeSparkImageSupport()}`);
    return;
  }
  await demo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "agent demo failed");
  process.exit(1);
});
