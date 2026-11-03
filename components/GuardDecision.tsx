// Shows the final decision and the evidence each source supplied.

export type DisplayVerdict = "READY" | "ALLOW" | "BLOCK" | "HOLD";

export interface DecisionSources {
  sparkClaim: readonly string[];
  samDetected: readonly string[];
  voiceTranscript: string;
  imageText: string;
}

interface GuardDecisionProps {
  verdict: DisplayVerdict;
  reason: string;
  guardOn: boolean;
  sources: DecisionSources | null;
}

const VERDICT_STYLES: Record<DisplayVerdict, string> = {
  READY: "border-zinc-700 bg-zinc-900 text-zinc-300",
  ALLOW: "border-emerald-400 bg-emerald-600 text-white",
  BLOCK: "border-red-300 bg-red-600 text-white shadow-[0_0_60px_rgba(220,38,38,0.6)]",
  HOLD: "border-amber-400 bg-amber-500 text-zinc-950",
};

function Badge({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 break-words font-mono text-sm">{value}</div>
    </div>
  );
}

function list(objects: readonly string[]): string {
  return objects.length > 0 ? objects.join(", ") : "(nothing)";
}

export default function GuardDecision({ verdict, reason, guardOn, sources }: GuardDecisionProps) {
  return (
    <section className="space-y-3">
      <div
        className={`rounded-2xl border-4 px-6 py-6 text-center transition ${VERDICT_STYLES[verdict]}`}
        role="status"
        aria-live="assertive"
      >
        <div className="text-xs font-bold uppercase tracking-[0.3em] opacity-80">
          {guardOn ? "SafeLabs Guard" : "Unguarded agent"}
        </div>
        <div className="mt-1 text-6xl font-black tracking-tight sm:text-7xl">{verdict}</div>
        <p className="mt-3 text-lg font-semibold">{reason}</p>
      </div>

      {sources && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Badge
            label="Spark claim"
            value={list(sources.sparkClaim)}
            tone="border-violet-700 bg-violet-950 text-violet-100"
          />
          <Badge
            label="SAM detected"
            value={list(sources.samDetected)}
            tone="border-sky-700 bg-sky-950 text-sky-100"
          />
          <Badge
            label="Voice transcript"
            value={sources.voiceTranscript ? `"${sources.voiceTranscript}"` : "(silence)"}
            tone="border-teal-700 bg-teal-950 text-teal-100"
          />
          {sources.imageText && (
            <Badge
              label="Image text"
              value={`"${sources.imageText}"`}
              tone="border-orange-700 bg-orange-950 text-orange-100"
            />
          )}
        </div>
      )}
    </section>
  );
}
