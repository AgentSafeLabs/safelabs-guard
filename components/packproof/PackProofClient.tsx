"use client";

// Browser client for the PackProof agent: camera frame (or an uploaded test
// image) + optional spoken clip -> POST /api/agent/turn -> guard result; SHIP
// approval -> POST /api/packproof/ship. The session token lives only in React
// state. Uploaded and captured frames are sent identically.
// All server text is rendered as React text nodes.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { STEPS } from "@/lib/guard/ledger";
import {
  AgentApiError,
  agentSawText,
  requestShip,
  sendTurn,
  startSession,
  type ClientSession,
  type ShipResponse,
  type TurnResponse,
} from "@/lib/client/agent-api";
import { captureFrame, startCamera, stopCamera } from "@/lib/client/camera";
import { failClosedExplanation, imageTextLabel, injectionBanner, sourceBadgeText } from "@/lib/client/labels";
import { checkUpload, UPLOAD_ACCEPT } from "@/lib/client/upload";
import { discardRecording, startRecording, stopRecording } from "@/lib/client/mic";
import { MAX_DURATION_SECONDS } from "@/lib/client/wav";
import type { AgentMode } from "@/lib/agent/types";

interface HistoryEntry {
  id: number;
  at: string;
  response: TurnResponse;
  hadAudio: boolean;
}

type SourceLabel = TurnResponse["sources"]["sam"];

interface Frame {
  blob: Blob;
  url: string;
  origin: "camera" | "uploaded";
}

const DECISION_STYLES: Record<string, string> = {
  ALLOW: "border-emerald-400 bg-emerald-600 text-white",
  BLOCK: "border-red-300 bg-red-600 text-white",
  HOLD: "border-amber-400 bg-amber-500 text-zinc-950",
  UNGUARDED: "border-amber-400 bg-amber-950 text-amber-200",
};

const SOURCE_STYLES: Record<SourceLabel, string> = {
  live: "border-emerald-600 bg-emerald-950 text-emerald-200",
  mock: "border-amber-600 bg-amber-950 text-amber-200",
  unavailable: "border-zinc-600 bg-zinc-900 text-zinc-400",
};

function messageOf(err: unknown): string {
  if (err instanceof AgentApiError) return err.serverReason ? `${err.message} (${err.serverReason})` : err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function SourceBadge({ label, source, detail, notSent }: { label: string; source: SourceLabel; detail?: string; notSent?: boolean }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${notSent ? SOURCE_STYLES.unavailable : SOURCE_STYLES[source] ?? SOURCE_STYLES.unavailable}`}
      title={detail}
    >
      {sourceBadgeText(label, source, { notSent })}
    </span>
  );
}

function StepTracker({ ledger }: { ledger: TurnResponse["ledger"] | null }) {
  const index = ledger ? (ledger.status === "COMPLETE" ? STEPS.length : ledger.stepIndex) : 0;
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Ledger steps">
      {STEPS.map((step, i) => {
        const state = i < index ? "done" : i === index ? "current" : "todo";
        const tone =
          state === "done"
            ? "border-emerald-600 bg-emerald-950 text-emerald-200"
            : state === "current"
              ? "border-white bg-zinc-800 text-white"
              : "border-zinc-800 bg-zinc-950 text-zinc-500";
        return (
          <li
            key={step}
            className={`rounded-md border px-1 py-1.5 text-center font-mono text-[10px] sm:text-xs ${tone}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            {state === "done" ? "✓ " : ""}
            {step}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-zinc-800 py-1.5 text-sm last:border-0">
      <span className="mr-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="break-words font-mono text-zinc-200">{value}</span>
    </div>
  );
}

function TurnCard({ entry, prominent }: { entry: HistoryEntry; prominent: boolean }) {
  const { turn, sources, ledger, shipped, perceptionDetail = {}, securityEvents = [] } = entry.response;
  const decision = turn.guard?.decision ?? "UNGUARDED";
  const reason = turn.guard ? turn.guard.reason : "No guard: the agent acted on its own proposal.";
  const banner = injectionBanner(securityEvents);
  const explanation = failClosedExplanation(turn.guard);
  const voiceNotSent = !entry.hadAudio || perceptionDetail.voice === "voice not sent";
  const unavailable = Object.entries(perceptionDetail).filter(([name, detail]) => detail && !(name === "voice" && voiceNotSent));
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-zinc-500">
          Turn {turn.turn} · {turn.mode} · {entry.at}
        </span>
        <span className="font-mono text-xs text-zinc-400">at {turn.step}</span>
      </header>
      {banner && (
        <div role="alert" className="mb-2 rounded-xl border-2 border-fuchsia-400 bg-fuchsia-950 px-3 py-2 text-sm font-bold text-fuchsia-100">
          ⚠ {banner}
          <ul className="mt-1 space-y-0.5 font-mono text-xs font-normal text-fuchsia-200">
            {securityEvents.map((e, i) => (
              <li key={i}>
                {e.source}: &quot;{e.excerpt}&quot;
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={`rounded-xl border-2 px-4 ${prominent ? "py-4" : "py-2"} text-center ${DECISION_STYLES[decision]}`}>
        <div className={`${prominent ? "text-4xl" : "text-xl"} font-black tracking-tight`}>{decision}</div>
        <p className="mt-1 text-sm font-semibold">{reason}</p>
        {explanation && <p className="mt-1 text-sm">{explanation}</p>}
      </div>
      <div className="mt-3">
        <Field label="Agent saw" value={agentSawText(turn)} />
        <Field label="Proposed" value={turn.sparkDecision.proposedAction} />
        <Field label="Claimed" value={turn.sparkDecision.claimedObjects.join(", ") || "(nothing)"} />
        <Field label="Rationale" value={turn.sparkDecision.rationale || "(none)"} />
        <Field label="Executed" value={turn.executed ?? "nothing"} />
        <Field label="SAM saw" value={turn.perception.samObjects.join(", ") || "(nothing)"} />
        <Field
          label="Heard"
          value={turn.perception.transcript ? `"${turn.perception.transcript}"` : entry.hadAudio ? "(no usable transcript)" : "(no audio sent)"}
        />
        <Field
          label={imageTextLabel(sources.vision)}
          value={turn.perception.imageText ? `"${turn.perception.imageText}"` : "(none read)"}
        />
        <Field label="Ledger" value={`${ledger.step} · ${ledger.status}${shipped ? " · SHIPPED" : ""}`} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Perception sources">
        <SourceBadge label="SAM" source={sources.sam} detail={perceptionDetail.sam} />
        <SourceBadge label="Image text" source={sources.vision} detail={perceptionDetail.vision} />
        <SourceBadge label="Spark" source={sources.spark} detail={perceptionDetail.spark} />
        <SourceBadge label="Voice" source={sources.voice} detail={perceptionDetail.voice} notSent={voiceNotSent} />
      </div>
      {unavailable.length > 0 && (
        <p className="mt-1 font-mono text-[11px] text-zinc-400">
          Why unavailable: {unavailable.map(([name, detail]) => `${name}: ${detail}`).join(" · ")}
        </p>
      )}
    </article>
  );
}

const button =
  "rounded-lg px-4 py-2 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40";

export default function PackProofClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyId = useRef(0);

  const [session, setSession] = useState<ClientSession>(() => startSession("guarded"));
  const [cameraOn, setCameraOn] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Start the camera, capture a frame, then send a turn.");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [approval, setApproval] = useState<string | null>(null);
  const [shipResult, setShipResult] = useState<ShipResponse | null>(null);

  const latest = history[0]?.response ?? null;
  const mode = session.mode;

  const replaceFrame = useCallback((next: Frame | null) => {
    setFrame((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return next;
    });
  }, []);

  const replaceClip = useCallback((next: { blob: Blob; url: string } | null) => {
    setClip((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return next;
    });
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(
    () => () => {
      clearTimer();
      stopCamera(videoRef.current);
      void discardRecording();
    },
    [],
  );

  function resetRun(nextMode: AgentMode) {
    setSession(startSession(nextMode));
    setHistory([]);
    setApproval(null);
    setShipResult(null);
    setError(null);
    setStatus(`New ${nextMode} run started at VERIFY_MUG.`);
  }

  async function toggleCamera() {
    setError(null);
    if (cameraOn) {
      stopCamera(videoRef.current);
      setCameraOn(false);
      setStatus("Camera off.");
      return;
    }
    if (!videoRef.current) return;
    try {
      await startCamera(videoRef.current, facing);
      setCameraOn(true);
      setStatus("Camera on.");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function flipCamera() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    if (cameraOn && videoRef.current) {
      try {
        await startCamera(videoRef.current, next);
      } catch (err) {
        setCameraOn(false);
        setError(messageOf(err));
      }
    }
  }

  async function capture() {
    if (!videoRef.current) return;
    setError(null);
    try {
      const blob = await captureFrame(videoRef.current);
      replaceFrame({ blob, url: URL.createObjectURL(blob), origin: "camera" });
      setStatus(`Frame captured (${Math.round(blob.size / 1024)} KB).`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // picking the same file again still fires change
    if (!file) return;
    setError(null);
    const check = await checkUpload(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    replaceFrame({ blob: file, url: URL.createObjectURL(file), origin: "uploaded" });
    setStatus(`Test image loaded (${Math.round(file.size / 1024)} KB). It goes through the same checks as a camera frame.`);
  }

  const finishRecording = useCallback(async () => {
    clearTimer();
    setRecording(false);
    try {
      const blob = await stopRecording();
      if (blob) {
        replaceClip({ blob, url: URL.createObjectURL(blob) });
        setStatus("Clip recorded. Play it back or discard it.");
      } else {
        setStatus("Nothing was recorded.");
      }
    } catch (err) {
      setError(messageOf(err));
    }
  }, [replaceClip]);

  async function toggleRecording() {
    setError(null);
    if (recording) {
      await finishRecording();
      return;
    }
    try {
      await startRecording();
    } catch (err) {
      setError(messageOf(err));
      return;
    }
    replaceClip(null);
    setRecording(true);
    setElapsed(0);
    setStatus(`Recording. Stops automatically at ${MAX_DURATION_SECONDS} seconds.`);
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - started) / 1000;
      setElapsed(secs);
      if (secs >= MAX_DURATION_SECONDS) void finishRecording();
    }, 200);
  }

  async function send() {
    if (!frame) return;
    setBusy(true);
    setError(null);
    setStatus("Sending turn…");
    try {
      const response = await sendTurn({
        mode: session.mode,
        token: session.token,
        image: frame.blob,
        audio: clip?.blob ?? null,
      });
      setSession({ mode: session.mode, token: response.session });
      historyId.current += 1;
      setHistory((h) => [
        { id: historyId.current, at: new Date().toLocaleTimeString(), response, hadAudio: Boolean(clip) },
        ...h,
      ]);
      if (response.approval) setApproval(response.approval);
      const decision = response.turn.guard?.decision ?? "UNGUARDED";
      setStatus(
        `Turn ${response.turn.turn}: ${decision}${response.turn.guard ? ` — ${response.turn.guard.reason}` : ""}. Ledger at ${response.ledger.step}.`,
      );
      replaceClip(null);
    } catch (err) {
      setError(messageOf(err));
      setStatus("Turn failed.");
      if (err instanceof AgentApiError && (err.kind === "session-invalid" || err.kind === "mode-mismatch")) {
        setSession(startSession(session.mode));
      }
    } finally {
      setBusy(false);
    }
  }

  async function ship() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestShip({ approval });
      setShipResult(result);
      setStatus(result.alreadyShipped ? "Already shipped: same shipment returned." : "Shipment created.");
    } catch (err) {
      setError(messageOf(err));
      if (err instanceof AgentApiError && err.kind === "approval-rejected") setApproval(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Mode */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Agent mode" className="flex rounded-full border border-zinc-700 p-1">
          {(["guarded", "unguarded"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => mode !== m && resetRun(m)}
              disabled={busy}
              className={`${button} rounded-full ${
                mode === m
                  ? m === "guarded"
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-amber-400 text-zinc-950"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {m === "guarded" ? "Guarded" : "Unguarded"}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">Changing mode starts a new run.</span>
        <button type="button" onClick={() => resetRun(mode)} disabled={busy} className={`${button} border border-zinc-700 text-zinc-300 hover:bg-zinc-800`}>
          Restart run
        </button>
      </div>
      {mode === "unguarded" && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-950 px-4 py-2 text-center font-bold text-amber-200">
          ⚠ Unguarded: the agent executes whatever it proposes
        </div>
      )}

      <StepTracker ledger={latest?.ledger ?? null} />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Inputs */}
        <section className="space-y-4 lg:col-span-3" aria-label="Turn inputs">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Camera preview" />
            {!cameraOn && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Camera is off</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toggleCamera} className={`${button} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}>
              {cameraOn ? "Stop camera" : "Start camera"}
            </button>
            <button type="button" onClick={flipCamera} className={`${button} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`} aria-label="Switch between front and back camera">
              Flip ({facing === "environment" ? "back" : "front"})
            </button>
            <button type="button" onClick={capture} disabled={!cameraOn} className={`${button} bg-white text-zinc-950 hover:bg-zinc-200`}>
              {frame ? "Retake" : "Capture"}
            </button>
            <label className={`${button} cursor-pointer border border-zinc-700 text-zinc-300 hover:bg-zinc-800 focus-within:ring-2 focus-within:ring-sky-400`}>
              Use a test image instead of the camera
              <input type="file" accept={UPLOAD_ACCEPT} onChange={upload} className="sr-only" />
            </label>
          </div>
          <p className="text-xs text-zinc-500">Test images: JPEG or PNG, up to 8 MB.</p>

          {frame && (
            <figure className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
              <img
                src={frame.url}
                alt={frame.origin === "uploaded" ? "Uploaded test image" : "Last captured frame"}
                className="h-20 w-32 rounded-lg border border-zinc-700 object-cover"
              />
              <figcaption className="text-xs text-zinc-400">
                {frame.origin === "uploaded" ? (
                  <span className="mr-1 rounded border border-sky-600 bg-sky-950 px-1 font-mono uppercase text-sky-200">uploaded</span>
                ) : (
                  "Captured frame · "
                )}
                {Math.round(frame.blob.size / 1024)} KB {frame.blob.type === "image/png" ? "PNG" : "JPEG"}
                <button type="button" onClick={() => replaceFrame(null)} className="ml-2 underline hover:text-zinc-200">
                  Clear
                </button>
              </figcaption>
            </figure>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={toggleRecording}
                aria-pressed={recording}
                className={`${button} ${recording ? "bg-red-600 text-white hover:bg-red-500" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"}`}
              >
                {recording ? "Stop recording" : "Record voice"}
              </button>
              {recording && (
                <span className="font-mono text-sm text-red-300" aria-label="Recording time">
                  ● {elapsed.toFixed(1)} / {MAX_DURATION_SECONDS}s
                </span>
              )}
              {clip && !recording && (
                <>
                  <audio src={clip.url} controls className="h-8" aria-label="Recorded clip preview" />
                  <button type="button" onClick={() => replaceClip(null)} className={`${button} border border-zinc-700 text-zinc-300 hover:bg-zinc-800`}>
                    Discard clip
                  </button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Voice is optional. Only what the server transcribes from this clip is used.
            </p>
          </div>

          <button
            type="button"
            onClick={send}
            disabled={!frame || busy || recording}
            className="w-full rounded-xl bg-white px-6 py-4 text-xl font-black text-zinc-950 transition hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
          >
            {busy ? "Working…" : `Send turn (${mode})`}
          </button>
          {!frame && <p className="text-xs text-zinc-500">Capture a frame or choose a test image first.</p>}
        </section>

        {/* Result */}
        <section className="space-y-4 lg:col-span-2" aria-label="Turn result">
          <p role="status" aria-live="polite" className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
            {status}
          </p>
          {error && (
            <p role="alert" className="rounded-lg border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          {history[0] ? (
            <TurnCard entry={history[0]} prominent />
          ) : (
            <p className="text-sm text-zinc-500">No turns yet.</p>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <button
              type="button"
              onClick={ship}
              disabled={!approval || busy}
              className={`${button} w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400`}
            >
              Ship order
            </button>
            <p className="mt-1 text-xs text-zinc-500">
              {approval ? "Approval received: the guard ALLOWed SHIP." : "Enabled only after the guard ALLOWs SHIP."}
            </p>
            {shipResult && (
              <div className="mt-2 text-sm" aria-live="polite">
                <Field label="Shipment" value={shipResult.shipment.shipmentId} />
                <Field label="Order" value={shipResult.shipment.orderId} />
                <Field label="Created" value={shipResult.shipment.createdAt} />
                <Field label="Status" value={shipResult.alreadyShipped ? "already shipped (same record)" : "new shipment"} />
              </div>
            )}
          </div>
        </section>
      </div>

      {history.length > 1 && (
        <section aria-label="Turn history" className="space-y-3">
          <h2 className="text-lg font-bold text-white">History (newest first)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {history.slice(1).map((entry) => (
              <TurnCard key={entry.id} entry={entry} prominent={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
