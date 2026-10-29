"use client";

// One real case, separate from the hero: upload a photo, type the agent's
// claimed object, and let live SAM + the existing reconcile() decide.

import { useState, type FormEvent } from "react";
import type { LiveCheckResult } from "@/lib/live/check";
import type { MetaSource } from "@/lib/meta/http";

function SourceBadge({ source }: { source: MetaSource }) {
  const tone =
    source === "live"
      ? "border-emerald-600 bg-emerald-950 text-emerald-200"
      : source === "unavailable"
        ? "border-red-600 bg-red-950 text-red-200"
        : "border-amber-600 bg-amber-950 text-amber-200";
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${tone}`}>{source}</span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 py-2 text-sm last:border-0">
      <span className="w-28 shrink-0 text-xs font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

export default function LiveVerification() {
  const [result, setResult] = useState<LiveCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/guard/live-check", { method: "POST", body: new FormData(event.currentTarget) });
      const body = await res.json();
      if (!res.ok) setError(body?.error ?? `Request failed (${res.status})`);
      else setResult(body as LiveCheckResult);
    } catch {
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-200";

  return (
    <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      <h2 className="text-lg font-bold text-white">Live verification</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Test one real photo. Fresh ORDER-1042 ledger at VERIFY_MUG, which expects{" "}
        <span className="font-mono text-zinc-200">red mug</span>: only a red-mug photo claimed as &ldquo;red
        mug&rdquo; can ALLOW. SAM checks whether the claimed object is in frame; it does not read text in
        the image.
      </p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-zinc-400">
          Photo
          <input name="image" type="file" accept="image/*" required className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs text-zinc-400">
          Agent&rsquo;s claimed object
          <input
            name="claimedObject"
            type="text"
            required
            maxLength={80}
            placeholder="red mug"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Voice confirmation (optional WAV, mono 16-bit, 16/24 kHz)
          <input name="audio" type="file" accept=".wav,audio/wav" className={`mt-1 ${inputClass}`} />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 px-3">
          <Row label="Claim">
            <span className="font-mono">{result.claimedObject}</span>
          </Row>
          <Row label="SAM 3.1">
            <SourceBadge source={result.sam.source} />
            {result.sam.verified === null ? (
              <span className="text-amber-300">
                {result.sam.source === "unavailable" ? "live call failed: nothing verified" : "not verified live (mock result ignored)"}
              </span>
            ) : (
              <span className="font-mono">verified: {String(result.sam.verified)}</span>
            )}
            {result.sam.error && <span className="text-xs text-zinc-500">({result.sam.error})</span>}
          </Row>
          {result.voice && (
            <Row label="Voice">
              <SourceBadge source={result.voice.source} />
              {result.voice.transcript === null ? (
                <span className="text-amber-300">
                  {result.voice.source === "unavailable" ? "live call failed: nothing transcribed" : "not transcribed live"}
                </span>
              ) : (
                <span className="font-mono">
                  {result.voice.transcript ? `"${result.voice.transcript}"` : "(silence)"}
                </span>
              )}
              {result.voice.error && <span className="text-xs text-zinc-500">({result.voice.error})</span>}
            </Row>
          )}
          <Row label="Guard">
            <span
              className={`rounded px-2 py-0.5 font-black ${
                result.decision === "ALLOW" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
              }`}
            >
              {result.decision}
            </span>
            <span>{result.reason}</span>
          </Row>
        </div>
      )}
    </section>
  );
}
