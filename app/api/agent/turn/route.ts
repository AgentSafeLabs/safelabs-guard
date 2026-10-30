// POST /api/agent/turn (multipart/form-data)
//   mode     required, "guarded" | "unguarded"
//   session  optional, signed session token from the previous response
//   image    optional, PNG/JPEG/WebP (magic bytes + readable header), max 8 MB
//   audio    optional, mono 16-bit PCM WAV at 16/24 kHz, max 1 MB
// Whole body max 9 MB (lib/server/limits.ts); other content types get 415.
// Runs one PackProof agent turn. See lib/server/agent-turn.ts.

import { handleTurn } from "../../../../lib/server/agent-turn";
import { rejectBadOrigin } from "../../../../lib/server/origin";
import { assertSafeRuntime, refusalResponse } from "../../../../lib/server/runtime-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cold OCR (worker start + traineddata load) plus live Meta calls. Each SAM
// call may retry once (2 x 10 s timeout, upload then response), so 30 s is not enough.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // Order matters: kill switch / production refusal first, then Origin, both
  // before the body is read. Rate limit and body checks are in handleTurn.
  const refusal = assertSafeRuntime(process.env);
  if (refusal) return refusalResponse(refusal);
  const badOrigin = rejectBadOrigin(request);
  if (badOrigin) return badOrigin;
  return handleTurn(request);
}
