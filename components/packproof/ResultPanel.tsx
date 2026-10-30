// Result box: verdict banner, four evidence cards, earlier turns. Everything
// shown comes from fields the turn response already carries; server text is
// rendered as React text nodes.

import type { ReactNode, RefObject } from "react";
import { AlertIcon, CheckIcon, ChevronDownIcon, XIcon } from "@/components/icons";
import { agentSawText, type ShipResponse } from "@/lib/client/agent-api";
import { failClosedExplanation, imageTextLabel, injectionBanner, isNotConsulted, sourceBadgeText } from "@/lib/client/labels";
import { evidenceSummaries, flaggedEvidence, imageTextView, verdictView, type EvidenceKey, type Tone } from "@/lib/client/result-view";
import type { HistoryEntry, SourceLabel } from "./types";

const SOURCE_STYLES: Record<SourceLabel, string> = {
  live: "border-allow-border bg-allow-bg text-allow-text",
  mock: "border-hold-border bg-hold-bg text-hold-text",
  unavailable: "border-line-strong bg-surface-2 text-muted",
};

const TONE_BOX: Record<Tone, string> = {
  allow: "border-allow-border bg-allow-bg text-allow-text",
  hold: "border-hold-border bg-hold-bg text-hold-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
};

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  return tone === "allow" ? <CheckIcon className={className} /> : tone === "danger" ? <XIcon className={className} /> : <AlertIcon className={className} />;
}

function SourceBadge({ label, source, detail, notSent }: { label: string; source: SourceLabel; detail?: string; notSent?: boolean }) {
  // Only a source that was never asked reads NOT CONSULTED; UNAVAILABLE means it was tried and failed.
  const notConsulted = !notSent && source === "unavailable" && isNotConsulted(detail);
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase ${notSent || notConsulted ? SOURCE_STYLES.unavailable : SOURCE_STYLES[source] ?? SOURCE_STYLES.unavailable}`}
      title={detail}
    >
      {sourceBadgeText(label, source, { notSent, notConsulted })}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line py-1.5 text-sm last:border-0">
      <span className="mr-2 text-[11px] font-bold uppercase tracking-widest text-muted">{label}</span>
      <span className="break-words font-mono text-soft">{value}</span>
    </div>
  );
}

/** Voice counts as "not sent" when no clip went out or the server says so. */
function voiceNotSentOf(entry: HistoryEntry): boolean {
  return !entry.hadAudio || entry.response.perceptionDetail?.voice === "voice not sent";
}

function Banner({ entry, shipped }: { entry: HistoryEntry; shipped: boolean }) {
  const { turn, securityEvents = [] } = entry.response;
  const v = verdictView(turn, shipped);
  const explanation = shipped ? null : failClosedExplanation(turn.guard);
  const inj = injectionBanner(securityEvents);
  const shadow = securityEvents.some((e) => e.shadow);
  return (
    <div className="space-y-3">
      {inj && (
        <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${shadow ? TONE_BOX.hold : TONE_BOX.danger}`}>
          <p className="flex items-start gap-2 font-bold">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{inj}</span>
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs font-normal">
            {securityEvents.map((e, i) => (
              <li key={i}>
                {e.source}: &quot;{e.excerpt}&quot;
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={`rounded-2xl border-2 p-4 ${TONE_BOX[v.tone]}`}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-90">{v.context}</p>
        <p className="mt-1 flex items-center gap-3 text-[28px] font-black leading-none tracking-tight sm:text-[32px]">
          <ToneIcon tone={v.tone} className="h-8 w-8 shrink-0" />
          <span>{v.word}</span>
        </p>
        <p className="mt-2 text-sm font-semibold">{v.reason}</p>
        {explanation && <p className="mt-1 text-sm">{explanation}</p>}
      </div>
    </div>
  );
}

function EvidenceCard({ title, summary, flagged, children }: { title: string; summary: string; flagged: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${flagged ? "border-hold-border bg-hold-bg" : "border-line bg-surface-2"}`} data-flagged={flagged ? "true" : undefined}>
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
        {title}
        {flagged && <span className="ml-2 normal-case tracking-normal text-hold-text">(caused the stop)</span>}
      </h3>
      <p className="mt-1 break-words text-base font-semibold text-ink">{summary}</p>
      <details className="group mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-accent">
          Details
          <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-1">{children}</div>
      </details>
    </div>
  );
}

function Evidence({ entry }: { entry: HistoryEntry }) {
  const { turn, sources, ledger, shipped, perceptionDetail = {} } = entry.response;
  const voiceNotSent = voiceNotSentOf(entry);
  const s = evidenceSummaries(entry.response, entry.hadAudio, voiceNotSent);
  const noisyText = imageTextView(entry.response).noisy;
  const flagged = new Set<EvidenceKey>(flaggedEvidence(turn.guard));
  const unavailable = Object.entries(perceptionDetail).filter(
    ([name, detail]) => detail && !(name === "voice" && voiceNotSent) && !isNotConsulted(detail),
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <EvidenceCard title="What the camera saw" summary={s.camera} flagged={flagged.has("camera")}>
          <Field label="Agent saw" value={agentSawText(turn)} />
          <Field label="SAM saw" value={turn.perception.samObjects.join(", ") || "(nothing)"} />
        </EvidenceCard>
        <EvidenceCard title="Text in the image" summary={s.text} flagged={flagged.has("text")}>
          <Field
            label={noisyText ? "Unreadable text found" : imageTextLabel(sources.vision)}
            value={turn.perception.imageText ? `"${turn.perception.imageText}"` : "(none read)"}
          />
        </EvidenceCard>
        <EvidenceCard title="What was heard" summary={s.voice} flagged={flagged.has("voice")}>
          <Field
            label="Heard"
            value={turn.perception.transcript ? `"${turn.perception.transcript}"` : entry.hadAudio ? "(no usable transcript)" : "(no audio sent)"}
          />
        </EvidenceCard>
        <EvidenceCard title="Spark proposed" summary={s.spark} flagged={flagged.has("spark")}>
          <Field label="Proposed" value={turn.sparkDecision.proposedAction} />
          <Field label="Claimed" value={turn.sparkDecision.claimedObjects.join(", ") || "(nothing)"} />
          <Field label="Rationale" value={turn.sparkDecision.rationale || "(none)"} />
          <Field label="Executed" value={turn.executed ?? "nothing"} />
          <Field label="Ledger" value={`${ledger.step} · ${ledger.status}${shipped ? " · SHIPPED" : ""}`} />
        </EvidenceCard>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Perception sources">
        <SourceBadge label="SAM" source={sources.sam} detail={perceptionDetail.sam} />
        <SourceBadge label="Image text" source={sources.vision} detail={perceptionDetail.vision} />
        <SourceBadge label="Spark" source={sources.spark} detail={perceptionDetail.spark} />
        <SourceBadge label="Voice" source={sources.voice} detail={perceptionDetail.voice} notSent={voiceNotSent} />
      </div>
      {unavailable.length > 0 && (
        <p className="font-mono text-xs text-muted">Why unavailable: {unavailable.map(([name, detail]) => `${name}: ${detail}`).join(" · ")}</p>
      )}
    </div>
  );
}

/** Compact card for the earlier-turns list. */
function TurnCard({ entry }: { entry: HistoryEntry }) {
  const { turn } = entry.response;
  const v = verdictView(turn, false);
  return (
    <article className="rounded-xl border border-line bg-surface-2 p-3">
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono">
          Turn {turn.turn} · {turn.mode} · {entry.at}
        </span>
        <span className="font-mono">at {turn.step}</span>
      </header>
      <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-lg font-black ${TONE_BOX[v.tone]}`}>
        <ToneIcon tone={v.tone} className="h-5 w-5 shrink-0" />
        {v.word}
      </p>
      <p className="mt-2 text-sm font-semibold text-soft">{v.reason}</p>
      <details className="group mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-accent">
          Details
          <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <Evidence entry={entry} />
      </details>
    </article>
  );
}

interface Props {
  history: readonly HistoryEntry[];
  sending: boolean;
  waited: number;
  shipResult: ShipResponse | null;
  /** Set by the page so it can scroll the card into view and focus its heading after a turn. */
  sectionRef?: RefObject<HTMLElement>;
  headingRef?: RefObject<HTMLHeadingElement>;
}

export default function ResultPanel({ history, sending, waited, shipResult, sectionRef, headingRef }: Props) {
  const latest = history[0];
  const announce = !sending && latest ? `Turn ${latest.response.turn.turn}: ${latest.response.turn.guard?.decision ?? "UNGUARDED"}. ${latest.response.turn.guard?.reason ?? ""}` : "";
  return (
    <section ref={sectionRef} aria-label="Turn result" className="scroll-mt-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-base font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        Result
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {sending ? (
        <div aria-live="polite" aria-busy="true">
          <p className="mb-3 text-base font-semibold text-soft">
            Checking frame...{waited > 0 && <span className="ml-2 font-mono text-sm text-muted">{waited} s</span>}
          </p>
          <div className="space-y-3" aria-hidden="true">
            <div className="h-24 animate-pulse rounded-2xl bg-chip" />
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-chip" />
              ))}
            </div>
          </div>
        </div>
      ) : latest ? (
        <div className="space-y-4">
          <Banner entry={latest} shipped={Boolean(shipResult) && Boolean(latest.response.approval)} />
          <Evidence entry={latest} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line-strong p-4">
          <p className="text-base font-bold text-ink">No turns yet</p>
          <p className="mt-1 text-sm text-muted">Start the camera, capture a frame, then send a turn. The verdict and evidence appear here.</p>
        </div>
      )}
      {history.length > 1 && !sending && (
        <details className="group mt-5 border-t border-line pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-bold text-ink">
            <span>Earlier turns ({history.length - 1})</span>
            <ChevronDownIcon className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-3">
            {history.slice(1).map((entry) => (
              <TurnCard key={entry.id} entry={entry} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
