// Five equal segments with a label under each. Presentational: callers decide
// each segment's state. Used on the home page (all done) and the live page.

import type { SegmentState } from "@/lib/client/progress";

export interface Segment {
  label: string;
  state: SegmentState;
  /** Spoken in place of the visual state, e.g. "Mug: done". */
  srText: string;
}

const BAR: Record<SegmentState, string> = {
  done: "bg-accent",
  current: "bg-accent outline outline-2 outline-offset-2 outline-accent",
  held: "bg-hold-text",
  blocked: "bg-danger-text",
  pending: "bg-pending",
};

export default function ProgressSegments({ segments, label }: { segments: readonly Segment[]; label: string }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label={label}>
      {segments.map((s) => (
        <li key={s.label} aria-current={s.state === "current" || s.state === "held" || s.state === "blocked" ? "step" : undefined}>
          <div className={`h-2 rounded-full ${BAR[s.state]}`} aria-hidden="true" />
          <span
            className={`mt-2 block text-center text-xs sm:text-sm ${
              s.state === "held" ? "font-bold text-hold-text" : s.state === "blocked" ? "font-bold text-danger-text" : s.state === "current" ? "font-bold text-allow-text" : "text-muted"
            }`}
          >
            {s.label}
            <span className="sr-only"> ({s.srText})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
