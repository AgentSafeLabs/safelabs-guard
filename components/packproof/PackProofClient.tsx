"use client";

// Browser client for the PackProof agent: camera frame (or an uploaded test
// image) + optional spoken clip -> POST /api/agent/turn -> guard result; SHIP
// approval -> POST /api/packproof/ship. The session token lives only in React
// state. Uploaded and captured frames are sent identically.
// All server text is rendered as React text nodes.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
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
import { DEFAULT_MODE } from "@/lib/client/run-mode";
import { isTypingTarget, planResultScroll, shouldRevealResult } from "@/lib/client/scroll";
import { discardRecording, startRecording, stopRecording } from "@/lib/client/mic";
import { MAX_DURATION_SECONDS } from "@/lib/client/wav";
import type { AgentMode } from "@/lib/agent/types";
import InputPanel from "./InputPanel";
import ModeControls from "./ModeControls";
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

export default function PackProofClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyId = useRef(0);
  const resultRef = useRef<HTMLElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const recordingRef = useRef(false);

  const [session, setSession] = useState<ClientSession>(() => startSession(DEFAULT_MODE));
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
  const [compareOpen, setCompareOpen] = useState(false);
  // Counts turns that ended (any outcome); the result is brought into view when it grows.
  const [finishedTurns, setFinishedTurns] = useState(0);

  const latest = history[0]?.response ?? null;
  const mode = session.mode;
  recordingRef.current = recording;

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

  useEffect(() => {
    if (!shouldRevealResult({ finishedTurns, recording: recordingRef.current })) return;
    const card = resultRef.current;
    if (!card) return;
    const plan = planResultScroll({
      stacked: !window.matchMedia("(min-width: 1024px)").matches,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      rect: card.getBoundingClientRect(),
      viewportHeight: window.innerHeight,
    });
    if (plan.scroll) card.scrollIntoView({ behavior: plan.behavior, block: "start" });
    // Never take focus from a field the person is using; the result's live region still announces it.
    if (!isTypingTarget(document.activeElement as HTMLElement | null)) resultHeadingRef.current?.focus({ preventScroll: true });
  }, [finishedTurns]);

  function switchMode(next: AgentMode) {
    if (next === mode) return;
    setCompareOpen(false);
    resetRun(next);
  }

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
      setFinishedTurns((n) => n + 1);
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
      <ModeControls
        mode={mode}
        busy={busy}
        compareOpen={compareOpen}
        onToggleCompare={() => setCompareOpen((open) => !open)}
        onSwitch={switchMode}
        onRestart={() => resetRun(mode)}
      />

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
          <ResultPanel history={history} sending={sending} waited={waited} shipResult={shipResult} sectionRef={resultRef} headingRef={resultHeadingRef} />
          <ShipPanel approval={approval} shipResult={shipResult} busy={busy} onShip={ship} />
        </div>
      </div>
    </div>
  );
}
