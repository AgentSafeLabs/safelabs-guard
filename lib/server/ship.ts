// POST /api/packproof/ship handler: turns a valid SHIP approval into a
// simulated shipment.
//
// STATELESS IDEMPOTENCY: the shipment is a pure function of the verified
// approval. The id is an HMAC (token secret) over the order id and the
// approval's jti, and createdAt is the approval's iat. Any instance holding
// the same secret returns the identical record for the same approval, with no
// shared store. The approval carries no run id; its jti is unique per issue
// and an approval is minted once per guarded run, so the jti identifies the run.
//
// What this cannot do: tell a first call from a repeat (no state), or stop a
// second, different approval (a second guarded run) from shipping the same
// order again. Both need a durable store (PR1). The response therefore says
// status "shipment", never "new shipment".

import { ORDER_1042 } from "../guard/ledger";
import { verifyApproval, type ApprovalPayload } from "../agent/approval";
import { deriveId, TokenConfigError } from "../agent/signing";
import { MAX_JSON_BODY_BYTES } from "./limits";
import { checkRate, clientIp } from "./rate-limit";
import { readJsonObject } from "./request-guard";

export interface ShipmentRecord {
  shipmentId: string;
  orderId: string;
  createdAt: string;
}

/** Pure: same verified approval, same record, on any instance. */
export function shipmentFor(approval: Pick<ApprovalPayload, "orderId" | "jti" | "iat">): ShipmentRecord {
  const digest = deriveId("shipment", [approval.orderId, approval.jti]);
  return {
    shipmentId: `SHP-${digest.subarray(0, 6).toString("hex").toUpperCase()}`,
    orderId: approval.orderId,
    createdAt: new Date(approval.iat * 1000).toISOString(),
  };
}

export async function handleShip(request: Request): Promise<Response> {
  const rate = checkRate(clientIp(request), Date.now(), "ship");
  if (!rate.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  }

  // 415 for another content type, 413 over 4 KB, 400 for bad JSON or a non-object.
  const parsed = await readJsonObject(request, MAX_JSON_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const approval = parsed.body.approval;

  try {
    const verified = verifyApproval(approval, ORDER_1042.id);
    if (!verified.ok) return Response.json({ error: "Approval rejected", reason: verified.reason }, { status: 403 });
    return Response.json({ shipment: shipmentFor(verified.payload), status: "shipment" });
  } catch (err) {
    if (err instanceof TokenConfigError) {
      return Response.json({ error: "Approval signing is not configured" }, { status: 503 });
    }
    console.error(`ship failed: ${err instanceof Error ? err.name : "unknown"}`);
    return Response.json({ error: "Ship failed" }, { status: 500 });
  }
}
