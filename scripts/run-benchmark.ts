// Runs data/asi-mm/cases.json through the guarded and unguarded agents,
// prints a per-category table and writes data/asi-mm/benchmark-results.json.
// Usage: npm run benchmark

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBenchmark, type AsiMmCase, type Tally } from "../lib/benchmark/run";

const DATA_DIR = join(__dirname, "..", "data", "asi-mm");
const CASES_PATH = join(DATA_DIR, "cases.json");
const RESULTS_PATH = join(DATA_DIR, "benchmark-results.json");

const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as AsiMmCase[];
const results = runBenchmark(cases);

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function frac(n: number, d: number, r: number): string {
  return `${n}/${d} (${pct(r)})`;
}

function row(label: string, category: string, t: Tally): Record<string, string | number> {
  // A rows report normal ALLOW rate; attack rows report attack success.
  const isNormal = t.attacks === 0;
  return {
    Group: label,
    Category: category,
    Cases: t.cases,
    Metric: isNormal ? "normal ALLOW" : "attack success",
    Unguarded: isNormal
      ? frac(t.unguardedNormalAllow, t.normals, t.unguardedNormalAllowRate)
      : frac(t.unguardedAttackSuccess, t.attacks, t.unguardedAttackSuccessRate),
    Guarded: isNormal
      ? frac(t.guardedNormalAllow, t.normals, t.guardedNormalAllowRate)
      : frac(t.guardedAttackSuccess, t.attacks, t.guardedAttackSuccessRate),
  };
}

const rows = Object.entries(results.byGroup).map(([group, t]) => {
  const category = results.cases.find((c) => c.group === group)?.category ?? "";
  return row(group, category, t);
});

const t = results.totals;

console.log("\nASI-MM benchmark · PackProof ORDER-1042\n");
console.table(rows);

console.log("\nTotals");
console.table([
  {
    Metric: `attack success (${t.attacks} attacks)`,
    Unguarded: frac(t.unguardedAttackSuccess, t.attacks, t.unguardedAttackSuccessRate),
    Guarded: frac(t.guardedAttackSuccess, t.attacks, t.guardedAttackSuccessRate),
  },
  {
    Metric: `normal ALLOW (${t.normals} normal)`,
    Unguarded: frac(t.unguardedNormalAllow, t.normals, t.unguardedNormalAllowRate),
    Guarded: frac(t.guardedNormalAllow, t.normals, t.guardedNormalAllowRate),
  },
]);

console.log("\nPer case");
console.table(
  results.cases.map((c) => ({
    Case: c.id,
    Step: c.ledgerStep,
    Attack: c.isAttack ? "yes" : "no",
    Unguarded: c.unguarded.decision,
    Guarded: c.guarded.decision,
    "Guard reason": c.guarded.reason,
  })),
);

writeFileSync(
  RESULTS_PATH,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      totals: results.totals,
      byGroup: results.byGroup,
      cases: results.cases.map((c) => ({
        id: c.id,
        category: c.category,
        ledgerStep: c.ledgerStep,
        isAttack: c.isAttack,
        guarded: c.guarded,
        unguarded: c.unguarded,
      })),
    },
    null,
    2,
  ) + "\n",
);

console.log(`\nWrote ${RESULTS_PATH}\n`);
