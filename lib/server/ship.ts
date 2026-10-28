// POST /api/packproof/ship handler: turns a valid SHIP approval into a
// simulated shipment. Idempotent by orderId.
//
// NON-DURABLE: shipments live in this process's memory, so a restart or a
// second serverless instance forgets them and could ship again. Must move to
// a durable store with single-use approval jti (PR1).

import { randomBytes } from "node:crypto";
import { ORDER_1042 } from "../guard/ledger";
import { verifyApproval } from "../agent/approval";
import { TokenConfigError } from "../agent/signing";
import { checkRate, clientIp } from "./rate-limit";

export interface ShipmentRecord {
  shipmentId: string;
  orderId: string;
  createdAt: string;
}

const shipments = new Map<string, ShipmentRecord>();

/** Tests only: forgets all simulated shipments. */
export function resetShipments(): void {
  shipments.clear();
}

export async function handleShip(request: Request): Promise<Response> {
  const rate = checkRate(clientIp(request));
  if (!rate.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const approval = (body as { approval?: unknown } | null)?.approval;

  try {
    const verified = verifyApproval(approval, ORDER_1042.id);
    if (!verified.ok) return Response.json({ error: "Approval rejected", reason: verified.reason }, { status: 403 });

    const orderId = verified.payload.orderId;
    const existing = shipments.get(orderId);
    if (existing) return Response.json({ shipment: existing, alreadyShipped: true });

    const shipment: ShipmentRecord = {
      shipmentId: `SHP-${randomBytes(6).toString("hex").toUpperCase()}`,
      orderId,
      createdAt: new Date().toISOString(),
    };
    shipments.set(orderId, shipment);
    return Response.json({ shipment, alreadyShipped: false });
  } catch (err) {
    if (err instanceof TokenConfigError) {
      return Response.json({ error: "Approval signing is not configured" }, { status: 503 });
    }
    return Response.json({ error: "Ship failed" }, { status: 500 });
  }
}
