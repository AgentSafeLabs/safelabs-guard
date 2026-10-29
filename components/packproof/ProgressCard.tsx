// One progress card for the five order steps, derived from the ledger the
// server returned (null before the first turn).

import ProgressSegments from "@/components/ProgressSegments";
import { deriveProgress, type LedgerLike } from "@/lib/client/progress";

export default function ProgressCard({ ledger, lastDecision }: { ledger: LedgerLike | null; lastDecision: string | null }) {
  const p = deriveProgress(ledger, lastDecision);
  const segments = p.segments.map((s) => ({
    ...s,
    srText: s.state === "done" ? "done" : s.state === "current" ? "current step" : s.state === "held" ? "held at this step" : "not started",
  }));
  return (
    <section aria-label="Progress" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-bold text-ink">
          Step {p.stepNumber} of {p.total} · {p.name}
        </p>
        {p.next && <p className="text-sm text-muted">Next: {p.next}</p>}
      </div>
      <ProgressSegments segments={segments} label="Order steps" />
      <p className="sr-only">
        Progress: step {p.stepNumber} of {p.total}, {p.name}.{p.complete ? " All steps are done." : ""}
      </p>
    </section>
  );
}
