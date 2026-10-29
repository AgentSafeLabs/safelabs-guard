// Optional voice clip: record, stop, replay, discard. Presentational; the
// recording logic lives in PackProofClient.

import { MicIcon, StopIcon } from "@/components/icons";
import { MAX_DURATION_SECONDS } from "@/lib/client/wav";

interface Props {
  recording: boolean;
  elapsed: number;
  clip: { url: string } | null;
  onToggle: () => void;
  onDiscard: () => void;
}

export default function VoiceCard({ recording, elapsed, clip, onToggle, onDiscard }: Props) {
  return (
    <section aria-label="Voice" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : "Record voice"}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            recording ? "bg-danger-text text-danger-bg" : "bg-chip text-ink hover:bg-line"
          }`}
        >
          {recording ? <StopIcon /> : <MicIcon />}
        </button>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Voice (optional)</h2>
          <p className="text-sm text-muted">Only what the server transcribes from this clip is used.</p>
        </div>
      </div>
      {recording && (
        <p className="mt-3 font-mono text-sm text-danger-text" aria-label="Recording time">
          ● {elapsed.toFixed(1)} / {MAX_DURATION_SECONDS}s
        </p>
      )}
      {clip && !recording && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <audio src={clip.url} controls className="h-11 max-w-full" aria-label="Recorded clip preview" />
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold text-soft hover:bg-chip"
          >
            Discard clip
          </button>
        </div>
      )}
    </section>
  );
}
