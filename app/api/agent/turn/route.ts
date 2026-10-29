// POST /api/agent/turn (multipart/form-data)
//   mode     required, "guarded" | "unguarded"
//   session  optional, signed session token from the previous response
//   image    optional, PNG/JPEG/WebP (checked by magic bytes), max 8 MB
//   audio    optional, WAV (RIFF/WAVE header), max 8 MB
// Runs one PackProof agent turn. See lib/server/agent-turn.ts.

import { handleTurn } from "../../../../lib/server/agent-turn";
import { assertSafeRuntime } from "../../../../lib/server/runtime-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cold OCR (worker start + traineddata load) plus live Meta calls. Each SAM
// call may retry once (2 x 10 s timeout, upload then response), so 30 s is not enough.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // Production refuses mock perception (see lib/server/runtime-mode.ts).
  const refusal = assertSafeRuntime(process.env);
  if (refusal) return Response.json({ error: refusal.error, reason: refusal.reason }, { status: refusal.status });
  return handleTurn(request);
}
