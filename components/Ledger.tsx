// Read-only view of the ledger. It renders whatever LedgerState it is given;
// LiveAgent only ever passes createLedger() output or reconcile()'s nextState.

import { ORDER_1042, STEPS, type LedgerState, type LedgerStep } from "@/lib/guard/ledger";

const STEP_LABELS: Record<LedgerStep, string> = {
  VERIFY_MUG: "Verify red mug",
  VERIFY_NOTEBOOK: "Verify blue notebook",
  VERIFY_CABLE: "Verify USB-C cable",
  SEAL: "Seal box",
  SHIP: "Approve ship",
};

interface LedgerProps {
  state: LedgerState;
  /** True when the guard blocked the current step. */
  blocked: boolean;
}

export default function Ledger({ state, blocked }: LedgerProps) {
  const complete = state.status === "COMPLETE";

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">Ledger</h2>
        <span className="font-mono text-sm text-zinc-300">{ORDER_1042.id}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {ORDER_1042.items.map((item) => (
          <li
            key={item.label}
            className="rounded-full border border-zinc-700 px-3 py-1 text-sm capitalize text-zinc-200"
          >
            {item.qty}x {item.label}
          </li>
        ))}
      </ul>

      <ol className="mt-5 space-y-2">
        {STEPS.map((step, i) => {
          const done = complete || i < state.stepIndex;
          const current = !complete && i === state.stepIndex;
          const isBlocked = current && blocked;

          let style = "border-zinc-800 bg-zinc-950 text-zinc-500";
          let marker = String(i + 1);
          if (done) {
            style = "border-emerald-600 bg-emerald-950 text-emerald-200";
            marker = "✓";
          } else if (isBlocked) {
            style = "border-red-500 bg-red-950 text-red-100 ring-2 ring-red-500 animate-pulse";
            marker = "✕";
          } else if (current) {
            style = "border-sky-500 bg-sky-950 text-sky-100 ring-2 ring-sky-500";
          }

          return (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${style}`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-sm font-bold">
                {marker}
              </span>
              <span className="flex-1">
                <span className="block font-mono text-xs opacity-70">{step}</span>
                <span className="block font-medium">{STEP_LABELS[step]}</span>
              </span>
              {isBlocked && <span className="text-xs font-black tracking-widest">BLOCKED</span>}
              {current && !blocked && <span className="text-xs font-bold tracking-widest">CURRENT</span>}
            </li>
          );
        })}
      </ol>

      {complete && (
        <p className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-center font-bold text-white">
          ORDER SHIPPED
        </p>
      )}
    </section>
  );
}
