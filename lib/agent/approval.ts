// Signed SHIP approval tokens (HMAC-SHA256, 5 minute life). The turn route
// issues one ONLY when guardAction() ALLOWed a SHIP at the SHIP step; the
// ship route requires it. Stateless: replay within 5 minutes is stopped by the
// ship route's idempotency, which is per approval (one shipment per approval
// token), not by the token (single-use needs PR1).

import { ORDER_1042 } from "../guard/ledger";
import { checkSchema, newJti, nowSeconds, signToken, verifySignature, type VerifyResult } from "./signing";

export const APPROVAL_TTL_SECONDS = 5 * 60;

export interface ApprovalPayload {
  v: 1;
  type: "approval";
  action: "SHIP";
  orderId: string;
  jti: string;
  iat: number;
  exp: number;
}

const SCHEMA = {
  v: "number",
  type: "string",
  action: "string",
  orderId: "string",
  jti: "string",
  iat: "number",
  exp: "number",
} as const;

/** Evidence the caller must hold: the gate result for this turn. */
export interface ShipAllowance {
  mode: "guarded";
  step: "SHIP";
  proposedAction: "SHIP";
  decision: "ALLOW";
}

export function isShipAllowance(x: {
  mode: string;
  step: string;
  proposedAction: string;
  decision: string | undefined;
}): x is ShipAllowance {
  return x.mode === "guarded" && x.step === "SHIP" && x.proposedAction === "SHIP" && x.decision === "ALLOW";
}

export function signApproval(orderId: string, allowance: ShipAllowance, now: number = Date.now()): string {
  if (!isShipAllowance(allowance)) throw new Error("Approval requires an ALLOWed guarded SHIP at the SHIP step");
  const iat = nowSeconds(now);
  const payload: ApprovalPayload = {
    v: 1,
    type: "approval",
    action: "SHIP",
    orderId,
    jti: newJti(),
    iat,
    exp: iat + APPROVAL_TTL_SECONDS,
  };
  return signToken("approval", payload);
}

/** Verifies signature, schema, version, type, action and expiry. Order check: `expectedOrderId`. */
export function verifyApproval(
  token: unknown,
  expectedOrderId: string = ORDER_1042.id,
  now: number = Date.now(),
): VerifyResult<ApprovalPayload> {
  const signed = verifySignature("approval", token);
  if (!signed.ok) return signed;
  const p = signed.payload;
  const schemaError = checkSchema(p, SCHEMA);
  if (schemaError) return { ok: false, reason: schemaError };
  if (p.v !== 1) return { ok: false, reason: "unsupported token version" };
  if (p.type !== "approval") return { ok: false, reason: "not an approval token" };
  if (p.action !== "SHIP") return { ok: false, reason: "approval is not for SHIP" };
  if ((p.exp as number) <= nowSeconds(now)) return { ok: false, reason: "approval expired" };
  if (p.orderId !== expectedOrderId) return { ok: false, reason: "approval is for a different order" };
  return { ok: true, payload: p as unknown as ApprovalPayload };
}
