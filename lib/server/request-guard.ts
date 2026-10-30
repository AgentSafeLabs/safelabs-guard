// Request validation that runs BEFORE any paid call: content type, body size
// (Content-Length first, then a byte count while reading), JSON shape, and
// byte-level checks of uploaded images and audio.
//
// Replies are short and generic; nothing here echoes request content.

import { BodyTooLargeError, formDataFrom, readBodyLimited } from "./body-limit";
import { MAX_IMAGE_PIXELS, WAV_SAMPLE_RATES } from "./limits";

export type Checked<T> = ({ ok: true } & T) | { ok: false; response: Response };

function fail(status: number, error: string): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error }, { status }) };
}

export const tooLarge = () => fail(413, "Request body is too large");

/** multipart/form-data only (415 otherwise), at most maxBytes (413), parseable (400). */
export async function readMultipart(request: Request, maxBytes: number): Promise<Checked<{ form: FormData }>> {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("content-type") ?? "")) {
    return fail(415, "Unsupported content type");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBodyLimited(request, maxBytes);
  } catch (err) {
    return err instanceof BodyTooLargeError ? tooLarge() : fail(400, "Expected multipart/form-data");
  }
  try {
    return { ok: true, form: await formDataFrom(bytes, request.headers.get("content-type")) };
  } catch {
    return fail(400, "Expected multipart/form-data");
  }
}

/** application/json only (415), at most maxBytes (413), valid JSON (400), a plain object (400). */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Checked<{ body: Record<string, unknown> }>> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return fail(415, "Unsupported content type");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBodyLimited(request, maxBytes);
  } catch (err) {
    return err instanceof BodyTooLargeError ? tooLarge() : fail(400, "Expected a JSON body");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail(400, "Expected a JSON body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail(400, "Expected a JSON object");
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

/** Decoded size read from the header, or null when the header is not that of a real image. */
function dimensions(b: Buffer, type: ImageType): { width: number; height: number } | null {
  if (type === "image/png") {
    // 8-byte signature, then the IHDR chunk: length 13, "IHDR", width, height.
    if (b.length < 24 || b.readUInt32BE(8) !== 13 || b.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (type === "image/jpeg") {
    // Walk the marker segments to the first start-of-frame (SOF0-15 except DHT/JPG/DAC).
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // image data or end before any frame header
      const length = b.readUInt16BE(i + 2);
      if (length < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (i + 9 > b.length) return null;
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
    return null;
  }
  // WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X (extended) first chunk.
  if (b.length < 30) return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** PNG, JPEG or WebP by magic bytes. Returns the MIME type to use, or null. */
export function sniffImage(head: Uint8Array): ImageType | null {
  const b = Buffer.from(head);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export type ImageCheck =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; error: "image must be PNG, JPEG or WebP" | "image dimensions are too large" };

/**
 * Magic bytes AND a readable header with sane dimensions. Random bytes after a
 * valid signature, or a tiny file that declares a huge canvas, are refused here
 * so they never reach a paid upstream call or the OCR decoder.
 */
export function inspectImage(bytes: Uint8Array): ImageCheck {
  const type = sniffImage(bytes);
  const dim = type ? dimensions(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), type) : null;
  if (!type || !dim || dim.width < 1 || dim.height < 1) return { ok: false, error: "image must be PNG, JPEG or WebP" };
  if (dim.width * dim.height > MAX_IMAGE_PIXELS) return { ok: false, error: "image dimensions are too large" };
  return { ok: true, type, ...dim };
}

/**
 * RIFF/WAVE with a "fmt " chunk that is mono 16-bit PCM at 16 or 24 kHz, the
 * only format the Voice client accepts. A RIFF/WAVE signature followed by junk
 * fails here.
 */
export function isValidWav(bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 12 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return false;
  const limit = Math.min(b.length, 512);
  for (let i = 12; i + 8 <= limit; ) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      if (size < 16 || i + 24 > b.length) return false;
      const format = b.readUInt16LE(i + 8);
      const channels = b.readUInt16LE(i + 10);
      const rate = b.readUInt32LE(i + 12);
      const bits = b.readUInt16LE(i + 22);
      return format === 1 && channels === 1 && bits === 16 && (WAV_SAMPLE_RATES as readonly number[]).includes(rate);
    }
    i += 8 + size + (size % 2);
  }
  return false;
}
