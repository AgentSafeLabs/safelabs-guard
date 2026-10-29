// "How it works": the path from inputs to a verdict, built from flex/grid
// boxes. Horizontal on desktop, a vertical stack on mobile.

import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, AlertIcon } from "@/components/icons";

function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center text-muted" aria-hidden="true">
      <ArrowDownIcon className="h-5 w-5 lg:hidden" />
      <ArrowRightIcon className="hidden h-5 w-5 lg:block" />
    </div>
  );
}

function Box({ title, note, className = "" }: { title: string; note?: string; className?: string }) {
  return (
    <div className={`flex min-h-14 flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-center ${className}`}>
      <span className="text-sm font-semibold text-ink">{title}</span>
      {note && <span className="mt-0.5 text-xs text-muted sm:text-sm lg:text-xs">{note}</span>}
    </div>
  );
}

function Column({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export default function Pipeline() {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-3" role="group" aria-label="How a turn is checked, in order">
      <Column label="Inputs" className="grid grid-cols-2 gap-3 lg:flex lg:w-36 lg:flex-col lg:justify-center">
        <Box title="Camera frame" />
        <Box title="Voice clip" />
      </Column>
      <Arrow />
      <Column label="Perception" className="grid grid-cols-3 gap-3 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
        <Box title="SAM 3.1" note="finds objects" />
        <Box title="OCR" note="reads text in frame" />
        <Box title="Muse Voice" note="transcribes speech" />
      </Column>
      <Arrow />
      <Column label="Reasoning" className="flex lg:flex-1 lg:flex-col lg:justify-center">
        <Box title="Muse Spark" note="proposes an action from a text report" className="w-full" />
      </Column>
      <Arrow />
      <Column label="Guard" className="flex lg:flex-1 lg:flex-col lg:justify-center">
        <div className="flex min-h-14 w-full flex-col justify-center rounded-xl border-2 border-accent bg-allow-bg px-3 py-3 text-center">
          <span className="text-sm font-bold text-allow-text">Guard</span>
          <span className="mt-0.5 text-xs text-soft sm:text-sm lg:text-xs">fixed rules, no AI model</span>
        </div>
      </Column>
      <Arrow />
      <Column label="Outcomes" className="grid grid-cols-2 gap-3 lg:flex lg:w-32 lg:flex-col lg:justify-center">
        <span className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-allow-border bg-allow-bg px-3 text-sm font-bold text-allow-text">
          <CheckIcon className="h-4 w-4" />
          ALLOW
        </span>
        <span className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-hold-border bg-hold-bg px-3 text-sm font-bold text-hold-text">
          <AlertIcon className="h-4 w-4" />
          HOLD
        </span>
      </Column>
    </div>
  );
}
