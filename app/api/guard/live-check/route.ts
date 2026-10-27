// POST /api/guard/live-check (multipart/form-data)
//   image          required, image/* file
//   claimedObject  required, text (e.g. "red mug")
//   audio          optional, WAV file (mono 16-bit PCM, 16 or 24 kHz)
// Converts uploads to data URIs and runs runLiveCheck(). Keys stay server-side
// in the Meta clients; nothing here reads or logs them.

import { runLiveCheck } from "../../../../lib/live/check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CLAIM_LENGTH = 80;

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Expected multipart/form-data");
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) return badRequest("Missing image file");
  if (!image.type.startsWith("image/")) return badRequest("image must be an image/* file");
  if (image.size > MAX_BYTES) return badRequest("image is larger than 8 MB");

  const claimRaw = form.get("claimedObject");
  const claimedObject = typeof claimRaw === "string" ? claimRaw.trim() : "";
  if (!claimedObject) return badRequest("Missing claimedObject");
  if (claimedObject.length > MAX_CLAIM_LENGTH) return badRequest("claimedObject is too long");

  const audioField = form.get("audio");
  let audio: string | undefined;
  if (audioField instanceof File && audioField.size > 0) {
    if (audioField.size > MAX_BYTES) return badRequest("audio is larger than 8 MB");
    if (!(await isWav(audioField))) return badRequest("audio must be a WAV file");
    audio = await toDataUri(audioField, "audio/wav");
  }

  try {
    const result = await runLiveCheck({
      frame: await toDataUri(image, image.type),
      claimedObject,
      audio,
    });
    return Response.json(result);
  } catch {
    // Clients already fall back to mocks; this only guards unexpected bugs.
    return Response.json({ error: "Live check failed" }, { status: 500 });
  }
}
