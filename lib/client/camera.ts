// Browser camera: start a preview in a <video>, stop it, grab a JPEG frame.

import { canvasToJpeg, computeTargetSize } from "./image";
import { assertMediaAvailable, MediaAccessError, toMediaError } from "./media-errors";

let stream: MediaStream | null = null;

export async function startCamera(
  video: HTMLVideoElement,
  facingMode: "environment" | "user" = "environment",
): Promise<void> {
  const devices = assertMediaAvailable("camera");
  stopCamera();
  try {
    stream = await devices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    throw toMediaError(err, "camera");
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true; // iOS Safari: no fullscreen takeover
  await video.play().catch(() => {});
}

export function stopCamera(video?: HTMLVideoElement | null): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export function isCameraOn(): boolean {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));
}

/** Draws the current video frame (longest edge <= 1280) and encodes it as JPEG under 8 MB. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new MediaAccessError("The camera has not produced a frame yet. Wait a moment and try again.", "unknown");
  }
  const { width, height } = computeTargetSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MediaAccessError("This browser cannot draw camera frames.", "unsupported");
  ctx.drawImage(video, 0, 0, width, height);
  return canvasToJpeg(canvas);
}
