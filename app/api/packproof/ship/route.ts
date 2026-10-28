// POST /api/packproof/ship (application/json) { "approval": "<token>" }
// Creates a simulated, idempotent shipment for a valid SHIP approval.
// See lib/server/ship.ts.

import { handleShip } from "../../../../lib/server/ship";
import { assertSafeRuntime } from "../../../../lib/server/runtime-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Production refuses mock perception (see lib/server/runtime-mode.ts).
  const refusal = assertSafeRuntime(process.env);
  if (refusal) return Response.json({ error: refusal.error, reason: refusal.reason }, { status: refusal.status });
  return handleShip(request);
}
