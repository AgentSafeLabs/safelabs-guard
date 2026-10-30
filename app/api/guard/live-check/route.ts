// POST /api/guard/live-check (multipart/form-data)
//   image          required, PNG/JPEG/WebP (checked by magic bytes)
//   claimedObject  required, text (e.g. "red mug")
//   audio          optional, WAV file (mono 16-bit PCM, 16 or 24 kHz)
// Whole body max 8 MB (413), multipart only (415), image header and WAV format
// checked before any Meta call (400). Converts uploads to data URIs and runs runLiveCheck().
// Keys stay server-side in the Meta clients; nothing here reads or logs them.
//
// Billed route, so it shares lib/server/rate-limit.ts with /api/agent/turn:
// per-IP limit, daily live budget and the SAFELABS_LIVE_DISABLED kill switch.
// Order: kill switch, Origin, per-IP limit, body checks, daily budget. Every
// refusal happens before any Meta call and fails closed (decision BLOCK).

import { runLiveCheck } from "../../../../lib/live/check";
import { shouldUseLive } from "../../../../lib/meta/http";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_LIVE_CHECK_BODY_BYTES } from "../../../../lib/server/limits";
import { rejectBadOrigin } from "../../../../lib/server/origin";
import {
  checkRate,
  clientIp,
  consumeLiveBudget,
  isLiveDisabled,
  secondsUntilBudgetReset,
} from "../../../../lib/server/rate-limit";
import { inspectImage, isValidWav, readMultipart } from "../../../../lib/server/request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function dataUri(type: string, bytes: Uint8Array): string {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Kill switch, before anything is parsed. 2. Origin. 3. Per-IP limit.
  if (isLiveDisabled()) return blocked(503, "Live checks are disabled", "live checks are disabled");
  const badOrigin = rejectBadOrigin(request);
  if (badOrigin) return badOrigin;
  const rate = checkRate(clientIp(request));
  if (!rate.allowed) return blocked(429, "Too many requests", "rate limit exceeded", rate.retryAfter);

  // 415 for another content type, 413 over the body cap, 400 if unparseable.
  const parsed = await readMultipart(request, MAX_LIVE_CHECK_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const form = parsed.form;

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) return badRequest("Missing image file");
  if (!image.type.startsWith("image/")) return badRequest("image must be an image/* file");
  if (image.size > MAX_IMAGE_BYTES) return badRequest("image is larger than 8 MB");
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const checked = inspectImage(imageBytes);
  if (!checked.ok) return badRequest(checked.error);

  const claimRaw = form.get("claimedObject");
  const claimedObject = typeof claimRaw === "string" ? claimRaw.trim() : "";
  if (!claimedObject) return badRequest("Missing claimedObject");
  if (claimedObject.length > MAX_CLAIM_LENGTH) return badRequest("claimedObject is too long");

  const audioField = form.get("audio");
  let audio: string | undefined;
  if (audioField instanceof File && audioField.size > 0) {
    if (audioField.size > MAX_AUDIO_BYTES) return badRequest("audio is larger than 1 MB");
    const audioBytes = new Uint8Array(await audioField.arrayBuffer());
    if (!isValidWav(audioBytes)) return badRequest("audio must be a WAV file");
    audio = dataUri("audio/wav", audioBytes);
  }

  // SAM: upload + response. Voice: one call when a clip was sent.
  const liveCalls =
    (shouldUseLive(process.env.META_SAM_API_KEY) ? 2 : 0) + (audio && shouldUseLive(process.env.META_VOICE_API_KEY) ? 1 : 0);
  if (liveCalls > 0 && !consumeLiveBudget(liveCalls)) {
    return blocked(429, "Daily live budget exhausted", "daily live budget exhausted", secondsUntilBudgetReset());
  }

  try {
    const result = await runLiveCheck({
      frame: dataUri(checked.type, imageBytes),
      claimedObject,
      audio,
    });
    return Response.json(result);
  } catch (err) {
    // Clients already fall back to mocks; this only guards unexpected bugs.
    console.error(`live check failed: ${err instanceof Error ? err.name : "unknown"}`);
    return Response.json({ error: "Live check failed" }, { status: 500 });
  }
}
