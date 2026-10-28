// POST /api/guard/live-check (multipart/form-data)
//   image          required, PNG/JPEG/WebP (checked by magic bytes)
//   claimedObject  required, text (e.g. "red mug")
//   audio          optional, WAV file (mono 16-bit PCM, 16 or 24 kHz)
// Whole body max 8 MB. Converts uploads to data URIs and runs runLiveCheck().
// Keys stay server-side in the Meta clients; nothing here reads or logs them.
//
// Billed route, so it shares lib/server/rate-limit.ts with /api/agent/turn:
// per-IP limit, daily live budget and the SAFELABS_LIVE_DISABLED kill switch.
// Every refusal happens before any Meta call and fails closed (decision BLOCK).

import { runLiveCheck } from "../../../../lib/live/check";
import { shouldUseLive } from "../../../../lib/meta/http";
import { sniffImage } from "../../../../lib/server/agent-turn";
import { BodyTooLargeError, formDataFrom, readBodyLimited } from "../../../../lib/server/body-limit";
import {
  checkRate,
  clientIp,
  consumeLiveBudget,
  isLiveDisabled,
  secondsUntilBudgetReset,
} from "../../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CLAIM_LENGTH = 80;

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

function blocked(status: number, error: string, reason: string, retryAfter?: number): Response {
  return Response.json(
    { error, decision: "BLOCK", reason },
    { status, headers: retryAfter !== undefined ? { "Retry-After": String(retryAfter) } : undefined },
  );
}

async function toDataUri(file: File, type: string): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function isWav(file: File): Promise<boolean> {
  const head = Buffer.from(await file.slice(0, 12).arrayBuffer());
  return head.length === 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE";
}

export async function POST(request: Request): Promise<Response> {
  const rate = checkRate(clientIp(request));
  if (!rate.allowed) return blocked(429, "Too many requests", "rate limit exceeded", rate.retryAfter);
  if (isLiveDisabled()) return blocked(503, "Live checks are disabled", "kill switch on (SAFELABS_LIVE_DISABLED)");

  let form: FormData;
  try {
    form = await formDataFrom(await readBodyLimited(request, MAX_BODY_BYTES), request.headers.get("content-type"));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return Response.json({ error: "Request body is larger than 8 MB" }, { status: 413 });
    return badRequest("Expected multipart/form-data");
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) return badRequest("Missing image file");
  if (!image.type.startsWith("image/")) return badRequest("image must be an image/* file");
  if (image.size > MAX_BODY_BYTES) return badRequest("image is larger than 8 MB");
  const imageType = sniffImage(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
  if (!imageType) return badRequest("image must be PNG, JPEG or WebP");

  const claimRaw = form.get("claimedObject");
  const claimedObject = typeof claimRaw === "string" ? claimRaw.trim() : "";
  if (!claimedObject) return badRequest("Missing claimedObject");
  if (claimedObject.length > MAX_CLAIM_LENGTH) return badRequest("claimedObject is too long");

  const audioField = form.get("audio");
  let audio: string | undefined;
  if (audioField instanceof File && audioField.size > 0) {
    if (audioField.size > MAX_BODY_BYTES) return badRequest("audio is larger than 8 MB");
    if (!(await isWav(audioField))) return badRequest("audio must be a WAV file");
    audio = await toDataUri(audioField, "audio/wav");
  }

  // SAM: upload + response. Voice: one call when a clip was sent.
  const liveCalls =
    (shouldUseLive(process.env.META_SAM_API_KEY) ? 2 : 0) + (audio && shouldUseLive(process.env.META_VOICE_API_KEY) ? 1 : 0);
  if (liveCalls > 0 && !consumeLiveBudget(liveCalls)) {
    return blocked(429, "Daily live budget exhausted", "daily live budget exhausted", secondsUntilBudgetReset());
  }

  try {
    const result = await runLiveCheck({
      frame: await toDataUri(image, imageType),
      claimedObject,
      audio,
    });
    return Response.json(result);
  } catch {
    // Clients already fall back to mocks; this only guards unexpected bugs.
    return Response.json({ error: "Live check failed" }, { status: 500 });
  }
}
