// "Use a test image instead of the camera": checks a picked file before it
// replaces the frame. The server applies its own checks to every frame anyway
// (lib/server/agent-turn.ts); uploads and captures go through the same route.

import { MAX_IMAGE_BYTES } from "./image";

export const UPLOAD_ACCEPT = "image/jpeg,image/png";

export type UploadCheck = { ok: true } | { ok: false; error: string };

function looksLike(head: Uint8Array, type: string): boolean {
  if (type === "image/png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return head.length >= 8 && sig.every((b, i) => head[i] === b);
  }
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/** JPEG or PNG (by MIME type and magic bytes), non-empty, at most 8 MB. */
export async function checkUpload(file: Blob): Promise<UploadCheck> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    return { ok: false, error: "Choose a JPEG or PNG image." };
  }
  if (file.size === 0) return { ok: false, error: "That image file is empty." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "That image is larger than 8 MB." };
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!looksLike(head, file.type)) return { ok: false, error: "That file is not a valid JPEG or PNG image." };
  return { ok: true };
}
