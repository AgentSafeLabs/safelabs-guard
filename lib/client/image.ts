// Frame sizing and JPEG encoding for camera captures. The math and the
// quality search are pure; only canvasToJpeg touches the DOM.

/** The turn route rejects images over 8 MB. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4] as const;

export class ImageTooLargeError extends Error {
  constructor() {
    super("The photo is still over 8 MB at the lowest quality. Try a lower camera resolution.");
    this.name = "ImageTooLargeError";
  }
}

/** Scales (w, h) so the longer edge is at most maxEdge. Never upscales. */
export function computeTargetSize(w: number, h: number, maxEdge = 1280): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) throw new Error("Frame has no size yet");
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: Math.round(w), height: Math.round(h) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Tries each quality from high to low until the encoded Blob fits. */
export async function encodeUnderLimit(
  encode: (quality: number) => Promise<Blob | null>,
  maxBytes: number = MAX_IMAGE_BYTES,
  qualities: readonly number[] = JPEG_QUALITIES,
): Promise<Blob> {
  for (const quality of qualities) {
    const blob = await encode(quality);
    if (blob && blob.size > 0 && blob.size <= maxBytes) return blob;
  }
  throw new ImageTooLargeError();
}

export function canvasToJpeg(canvas: HTMLCanvasElement, maxBytes: number = MAX_IMAGE_BYTES): Promise<Blob> {
  return encodeUnderLimit(
    (quality) => new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality)),
    maxBytes,
  );
}
