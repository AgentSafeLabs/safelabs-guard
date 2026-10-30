// POST /api/packproof/ship (application/json) { "approval": "<token>" }
// Creates a simulated, idempotent shipment for a valid SHIP approval.
// See lib/server/ship.ts.

import { handleShip } from "../../../../lib/server/ship";
import { rejectBadOrigin } from "../../../../lib/server/origin";
import { assertSafeRuntime, refusalResponse } from "../../../../lib/server/runtime-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Kill switch / production refusal first, then Origin, before the body is read.
  const refusal = assertSafeRuntime(process.env);
  if (refusal) return refusalResponse(refusal);
  const badOrigin = rejectBadOrigin(request);
  if (badOrigin) return badOrigin;
  return handleShip(request);
}
