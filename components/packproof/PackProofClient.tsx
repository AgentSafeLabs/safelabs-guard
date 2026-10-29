"use client";

// Browser client for the PackProof agent: camera frame (or an uploaded test
// image) + optional spoken clip -> POST /api/agent/turn -> guard result; SHIP
// approval -> POST /api/packproof/ship. The session token lives only in React
// state. Uploaded and captured frames are sent identically.
// All server text is rendered as React text nodes.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertIcon } from "@/components/icons";
import {
  AgentApiError,
  requestShip,
  sendTurn,
  startSession,
  type ClientSession,
  type ShipResponse,
} from "@/lib/client/agent-api";
import { captureFrame, startCamera, stopCamera } from "@/lib/client/camera";
import { checkUpload, UPLOAD_ACCEPT } from "@/lib/client/upload";
import { discardRecording, startRecording, stopRecording } from "@/lib/client/mic";
import { MAX_DURATION_SECONDS } from "@/lib/client/wav";
import type { AgentMode } from "@/lib/agent/types";
import InputPanel from "./InputPanel";
import ProgressCard from "./ProgressCard";
import ResultPanel from "./ResultPanel";
import ShipPanel from "./ShipPanel";
import VoiceCard from "./VoiceCard";
import type { Frame, HistoryEntry, InputMode } from "./types";

function messageOf(err: unknown): string {
  if (err instanceof AgentApiError) return err.serverReason ? `${err.message} (${err.serverReason})` : err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

const modeButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";

export default function PackProofClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  // Display-only state for the redesigned layout.
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [chosen, setChosen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [waited, setWaited] = useState(0);

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

  useEffect(() => {
    if (!sending) {
      setWaited(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [sending]);

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
    setCameraError(null);
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
      setCameraError(messageOf(err));
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
        setCameraError(messageOf(err));
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
    setSending(true);
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
      if (response.approval) {
        setApproval(response.approval);
        setShipResult(null);
      }
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
      setSending(false);
    }
  }

  async function ship() {
    if (!approval || shipResult) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestShip({ approval });
      setShipResult(result);
      setStatus(`Shipped: ${result.shipment.shipmentId}.`);
    } catch (err) {
      setError(messageOf(err));
      if (err instanceof AgentApiError && err.kind === "approval-rejected") setApproval(null);
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    replaceFrame(null);
    setStatus(cameraOn ? "Camera on." : "Frame cleared.");
  }

  function chooseMode(next: InputMode) {
    if (next === inputMode) return;
    setInputMode(next);
    setCameraError(null);
    // Leaving the camera for an image: release the camera.
    if (next === "upload" && cameraOn) {
      stopCamera(videoRef.current);
      setCameraOn(false);
      setStatus("Camera off.");
    }
  }

  function chooseSource(next: InputMode) {
    setChosen(true);
    setInputMode(next);
    if (next === "camera" && !cameraOn) void toggleCamera();
  }

  const lastDecision = latest?.turn.guard?.decision ?? null;
  const canSend = Boolean(frame) && !busy && !recording;

  return (
    <div className="space-y-6">
      {/* Mode */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Agent mode" className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {(["guarded", "unguarded"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => mode !== m && resetRun(m)}
              disabled={busy}
              className={`${modeButton} ${mode === m ? "bg-accent text-accent-ink" : "text-soft hover:bg-chip"}`}
            >
              {m === "guarded" ? "Guarded" : "Unguarded"}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">Changing mode starts a new run.</span>
        <button
          type="button"
          onClick={() => resetRun(mode)}
          disabled={busy}
          className={`${modeButton} border border-line-strong text-soft hover:bg-chip sm:ml-auto`}
        >
          Restart run
        </button>
      </div>
      {mode === "unguarded" && (
        <div className="flex items-center gap-2 rounded-xl border border-hold-border bg-hold-bg px-4 py-3 font-bold text-hold-text">
          <AlertIcon className="h-5 w-5 shrink-0" />
          Unguarded: the agent executes whatever it proposes
        </div>
      )}

      <ProgressCard ledger={latest?.ledger ?? null} lastDecision={lastDecision} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Inputs */}
        <div className="space-y-4">
          <InputPanel
            videoRef={videoRef}
            fileRef={fileRef}
            accept={UPLOAD_ACCEPT}
            onFile={upload}
            inputMode={inputMode}
            chosen={chosen}
            cameraOn={cameraOn}
            facing={facing}
            frame={frame}
            cameraError={cameraError}
            onChoose={chooseSource}
            onMode={chooseMode}
            onToggleCamera={toggleCamera}
            onFlip={flipCamera}
            onCapture={capture}
            onRetake={retake}
          />
          <VoiceCard
            recording={recording}
            elapsed={elapsed}
            clip={clip}
            onToggle={toggleRecording}
            onDiscard={() => replaceClip(null)}
          />
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-accent px-6 text-lg font-black text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:bg-pending disabled:text-muted disabled:hover:brightness-100"
          >
            {busy ? "Working…" : `Send turn (${mode})`}
          </button>
          {!frame && <p className="text-sm text-muted">Capture a frame or choose a test image first.</p>}
          <p role="status" aria-live={sending ? "off" : "polite"} className="text-sm text-soft">
            {status}
          </p>
          {error && (
            <p role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-text">
              {error}
            </p>
          )}
        </div>

        {/* Result */}
        <div className="space-y-4">
          <ResultPanel history={history} sending={sending} waited={waited} shipResult={shipResult} />
          <ShipPanel approval={approval} shipResult={shipResult} busy={busy} onShip={ship} />
        </div>
      </div>
    </div>
  );
}
