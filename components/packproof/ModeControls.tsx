// Run controls: Restart run, the collapsed "Compare without the guard"
// disclosure, and the unguarded warning with its way back. Presentational:
// PackProofClient owns the mode and restarts the run on every change.

import { AlertIcon, ChevronDownIcon } from "@/components/icons";
import { COMPARE_HELP, COMPARE_LABEL, UNGUARDED_BANNER } from "@/lib/client/run-mode";
import type { AgentMode } from "@/lib/agent/types";

interface Props {
  mode: AgentMode;
  busy: boolean;
  /** Whether the "Compare without the guard" panel is open. */
  compareOpen: boolean;
  onToggleCompare: () => void;
  /** Starts a new run in `next` mode. */
  onSwitch: (next: AgentMode) => void;
  onRestart: () => void;
}

const control =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";

export default function ModeControls({ mode, busy, compareOpen, onToggleCompare, onSwitch, onRestart }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={compareOpen}
          aria-controls="compare-panel"
          onClick={onToggleCompare}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent"
        >
          {COMPARE_LABEL}
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${compareOpen ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={onRestart} disabled={busy} className={`${control} border border-line-strong text-soft hover:bg-chip sm:ml-auto`}>
          Restart run
        </button>
      </div>
      {compareOpen && (
        <div id="compare-panel" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
          <p className="min-w-0 flex-1 text-sm text-soft">{COMPARE_HELP}</p>
          {mode === "guarded" && (
            <button type="button" onClick={() => onSwitch("unguarded")} disabled={busy} className={`${control} border border-line-strong text-soft hover:bg-chip`}>
              Switch to unguarded
            </button>
          )}
        </div>
      )}
      {mode === "unguarded" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hold-border bg-hold-bg px-4 py-3 font-bold text-hold-text">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <AlertIcon className="h-5 w-5 shrink-0" />
            {UNGUARDED_BANNER}
          </span>
          <button type="button" onClick={() => onSwitch("guarded")} disabled={busy} className={`${control} border border-hold-border hover:bg-chip`}>
            Back to guarded
          </button>
        </div>
      )}
    </div>
  );
}
