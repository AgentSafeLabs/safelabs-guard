// Camera / uploaded-image panel. Presentational: every action is a callback
// into PackProofClient, which owns the camera, the file check and the frame.

import type { ReactNode, RefObject } from "react";
import { AlertIcon, CameraIcon, CheckIcon, FlipIcon, ImageIcon } from "@/components/icons";
import type { Frame, InputMode } from "./types";

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  fileRef: RefObject<HTMLInputElement>;
  accept: string;
  onFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  inputMode: InputMode;
  /** The mobile source chooser has been used (always true on desktop, which has the toggle). */
  chosen: boolean;
  cameraOn: boolean;
  facing: "environment" | "user";
  frame: Frame | null;
  cameraError: string | null;
  onChoose: (mode: InputMode) => void;
  onMode: (mode: InputMode) => void;
  onToggleCamera: () => void;
  onFlip: () => void;
  onCapture: () => void;
  onRetake: () => void;
}

const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-base font-bold text-accent-ink hover:brightness-110";
const secondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface-2 px-4 text-sm font-semibold text-ink hover:bg-chip";
const overlayBtn =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-page/80 px-4 text-sm font-semibold text-ink backdrop-blur hover:bg-page";

export function inputStatus(frame: Frame | null, cameraOn: boolean): "Frame ready" | "Camera live" | "No input yet" {
  return frame ? "Frame ready" : cameraOn ? "Camera live" : "No input yet";
}

function Corners() {
  const c = "absolute h-6 w-6 border-accent";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-3">
      <span className={`${c} left-0 top-0 rounded-tl-lg border-l-2 border-t-2`} />
      <span className={`${c} right-0 top-0 rounded-tr-lg border-r-2 border-t-2`} />
      <span className={`${c} bottom-0 left-0 rounded-bl-lg border-b-2 border-l-2`} />
      <span className={`${c} bottom-0 right-0 rounded-br-lg border-b-2 border-r-2`} />
    </div>
  );
}

function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-line-strong p-4 text-center">
      <span className="text-muted">{icon}</span>
      <div>
        <p className="text-base font-bold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{text}</p>
      </div>
      {children}
    </div>
  );
}

export default function InputPanel(p: Props) {
  const { frame, cameraOn, inputMode } = p;
  const status = inputStatus(frame, cameraOn);
  const showLive = cameraOn && !frame;
  const showEmpty = !cameraOn && !frame;
  return (
    <section aria-label="Turn inputs" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-ink">Input</h2>
        <span
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
            frame || cameraOn ? "border-allow-border bg-allow-bg text-allow-text" : "border-line bg-chip text-soft"
          }`}
        >
          {frame ? <CheckIcon className="h-4 w-4" /> : <span aria-hidden="true" className={`h-2 w-2 rounded-full ${cameraOn ? "bg-accent" : "bg-muted"}`} />}
          {status}
        </span>
      </div>

      <input ref={p.fileRef} type="file" accept={p.accept} onChange={p.onFile} hidden aria-label="Test image file" />

      {/* Mobile: choose a source before the viewport appears. */}
      {!p.chosen && (
        <div className="grid gap-3 md:hidden">
          <button type="button" onClick={() => p.onChoose("camera")} className="flex min-h-24 items-center gap-4 rounded-2xl border border-line-strong bg-surface-2 p-4 text-left hover:bg-chip">
            <CameraIcon className="h-8 w-8 shrink-0 text-accent" />
            <span className="text-base font-bold text-ink">Use live camera</span>
          </button>
          <button type="button" onClick={() => p.onChoose("upload")} className="flex min-h-24 items-center gap-4 rounded-2xl border border-line-strong bg-surface-2 p-4 text-left hover:bg-chip">
            <ImageIcon className="h-8 w-8 shrink-0 text-accent" />
            <span className="text-base font-bold text-ink">Upload an image</span>
          </button>
        </div>
      )}

      <div className={p.chosen ? "" : "hidden md:block"}>
        <div role="radiogroup" aria-label="Input source" className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {(
            [
              ["camera", "Live camera"],
              ["upload", "Upload image"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={inputMode === mode}
              onClick={() => p.onMode(mode)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${
                inputMode === mode ? "bg-chip text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-surface-2 md:aspect-[16/10]">
          <video
            ref={p.videoRef}
            className={`absolute inset-0 h-full w-full object-cover ${showLive ? "" : "invisible"}`}
            playsInline
            muted
            aria-label="Camera preview"
          />

          {showLive && (
            <>
              <Corners />
              <span className="absolute left-4 top-4 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-page/80 px-3 text-xs font-black tracking-widest text-ink">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger-text" />
                LIVE
              </span>
              <button
                type="button"
                onClick={p.onFlip}
                aria-label={`Flip camera (currently ${p.facing === "environment" ? "back" : "front"})`}
                className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-page/80 text-ink backdrop-blur hover:bg-page"
              >
                <FlipIcon />
              </button>
              <button
                type="button"
                onClick={p.onCapture}
                aria-label="Capture frame"
                className="absolute bottom-4 left-1/2 inline-flex h-[68px] w-[68px] -translate-x-1/2 items-center justify-center rounded-full border-4 border-ink bg-ink/20 backdrop-blur"
              >
                <span aria-hidden="true" className="h-12 w-12 rounded-full bg-ink" />
              </button>
            </>
          )}

          {frame && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
              <img
                src={frame.url}
                alt={frame.origin === "uploaded" ? "Uploaded test image" : "Last captured frame"}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <span className="absolute left-4 top-4 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-allow-border bg-allow-bg px-3 text-sm font-semibold text-allow-text">
                <CheckIcon className="h-4 w-4" />
                Frame ready
              </span>
              {frame.origin === "camera" ? (
                <button type="button" onClick={p.onRetake} className={`${overlayBtn} absolute bottom-4 right-4`}>
                  Retake
                </button>
              ) : (
                <button type="button" onClick={() => p.fileRef.current?.click()} className={`${overlayBtn} absolute bottom-4 right-4`}>
                  Replace image
                </button>
              )}
            </>
          )}

          {showEmpty && p.cameraError && inputMode === "camera" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 border-2 border-danger-border bg-danger-bg p-4 text-center">
              <AlertIcon className="h-8 w-8 text-danger-text" />
              <p role="alert" className="max-w-sm text-sm text-danger-text">
                {p.cameraError}
              </p>
              <button type="button" onClick={() => p.onMode("upload")} className={primary}>
                Use an image instead
              </button>
            </div>
          )}

          {showEmpty && !(p.cameraError && inputMode === "camera") && inputMode === "camera" && (
            <Empty
              icon={<CameraIcon className="h-10 w-10" />}
              title="Ready when you are"
              text="Start the camera and point it at the items you are packing. Nothing is recorded until you capture a frame."
            >
              <button type="button" onClick={p.onToggleCamera} className={primary}>
                Start camera
              </button>
            </Empty>
          )}

          {showEmpty && inputMode === "upload" && (
            <Empty
              icon={<ImageIcon className="h-10 w-10" />}
              title="Choose a test image"
              text="JPEG or PNG, up to 8 MB. It goes through the same checks as a camera frame."
            >
              <button type="button" onClick={() => p.fileRef.current?.click()} className={primary}>
                Choose image
              </button>
            </Empty>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {cameraOn && (
            <button type="button" onClick={p.onToggleCamera} className={secondary}>
              Stop camera
            </button>
          )}
          {frame ? (
            <p className="text-sm text-soft">Looks right? Add voice if you want, then send.</p>
          ) : (
            <p className="text-sm text-muted">Test images: JPEG or PNG, up to 8 MB.</p>
          )}
        </div>
      </div>
    </section>
  );
}
