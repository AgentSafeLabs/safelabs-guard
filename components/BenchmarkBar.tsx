// Compact proof bar shown below the live agent. Every number is read from
// data/asi-mm/benchmark-results.json, which `npm run benchmark` writes.

import results from "@/data/asi-mm/benchmark-results.json";
import type { Tally } from "@/lib/benchmark/run";

const totals: Tally = results.totals;
const byGroup: Record<string, Tally> = results.byGroup;

const CHIPS: { group: string; label: string }[] = [
  { group: "D", label: "Visual Injection" },
  { group: "E", label: "Audio Injection" },
  { group: "F", label: "Replay" },
];

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function RateRow({
  label,
  count,
  total,
  rate,
  barClass,
  textClass,
}: {
  label: string;
  count: number;
  total: number;
  rate: number;
  barClass: string;
  textClass: string;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_6rem] items-center gap-3 text-sm">
      <span className="text-zinc-300">{label}</span>
      <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(rate * 100, 1)}%` }} />
      </div>
      <span className={`text-right font-mono tabular-nums ${textClass}`}>
        {pct(rate)} <span className="text-zinc-500">{count}/{total}</span>
      </span>
    </div>
  );
}

export default function BenchmarkBar() {
  return (
    <section
      aria-labelledby="benchmark-heading"
      className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="benchmark-heading" className="text-base font-semibold text-white">
          ASI-MM Benchmark — {totals.cases} cases
        </h2>
        <p className="text-xs text-zinc-500">Attack success rate ({totals.attacks} attack cases)</p>
      </div>

      <div className="mt-4 space-y-2">
        <RateRow
          label="Unguarded"
          count={totals.unguardedAttackSuccess}
          total={totals.attacks}
          rate={totals.unguardedAttackSuccessRate}
          barClass="bg-gradient-to-r from-amber-500 to-red-500"
          textClass="text-red-400"
        />
        <RateRow
          label="Guarded"
          count={totals.guardedAttackSuccess}
          total={totals.attacks}
          rate={totals.guardedAttackSuccessRate}
          barClass="bg-emerald-500"
          textClass="text-emerald-400"
        />
      </div>

      <p className="mt-3 text-sm text-zinc-400">
        Normal ALLOW:{" "}
        <span className="font-mono text-zinc-200">
          {pct(totals.unguardedNormalAllowRate)} unguarded · {pct(totals.guardedNormalAllowRate)} guarded
        </span>{" "}
        <span className="text-zinc-500">
          ({totals.guardedNormalAllow}/{totals.normals})
        </span>
      </p>

      <ul className="mt-4 flex flex-wrap gap-2">
        {CHIPS.map(({ group, label }) => {
          const t = byGroup[group];
          return (
            <li
              key={group}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 font-mono text-xs text-zinc-300"
            >
              {label} <span className="text-red-400">{pct(t.unguardedAttackSuccessRate)}</span> →{" "}
              <span className="text-emerald-400">{pct(t.guardedAttackSuccessRate)}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-zinc-500">
        Run it yourself: <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">npm run benchmark</code>
      </p>
    </section>
  );
}
