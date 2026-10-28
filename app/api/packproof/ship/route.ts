// POST /api/packproof/ship (application/json) { "approval": "<token>" }
// Creates a simulated, idempotent shipment for a valid SHIP approval.
// See lib/server/ship.ts.

import { handleShip } from "../../../../lib/server/ship";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleShip(request);
}
