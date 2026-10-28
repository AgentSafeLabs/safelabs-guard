// POST /api/agent/turn (multipart/form-data)
//   mode     required, "guarded" | "unguarded"
//   session  optional, signed session token from the previous response
//   image    optional, PNG/JPEG/WebP (checked by magic bytes), max 8 MB
//   audio    optional, WAV (RIFF/WAVE header), max 8 MB
// Runs one PackProof agent turn. See lib/server/agent-turn.ts.

import { handleTurn } from "../../../../lib/server/agent-turn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleTurn(request);
}
