// Signed, stateless PackProof session tokens (HMAC-SHA256, 30 minute life).
// The token carries only ledger position and flags; the server rebuilds the
// session from it with ledger-seed.ts. Stateless means a token can be replayed
// until it expires; single-use needs a durable jti store (PR1).
//
// `mode` binds a session to guarded or unguarded runs, so a ledger that the
// unguarded baseline advanced without checks can never continue as guarded.

import { ORDER_1042, STEPS, type LedgerStep } from "../guard/ledger";
import { completedLedger, ledgerAtStep } from "./ledger-seed";
import { checkSchema, newJti, nowSeconds, signToken, verifySignature, type VerifyResult } from "./signing";
import type { AgentMode, PackSession } from "./types";

export const SESSION_TTL_SECONDS = 30 * 60;

export interface SessionPayload {
  v: 1;
  orderId: string;
  mode: AgentMode;
  step: LedgerStep;
  sealed: boolean;
  shipped: boolean;
  /** Turns completed so far in this session. */
  turn: number;
  iat: number;
  exp: number;
  jti: string;
}

export interface SessionState {
  orderId: string;
  mode: AgentMode;
  step: LedgerStep;
  sealed: boolean;
  shipped: boolean;
  turn: number;
}

const SCHEMA = {
  v: "number",
  orderId: "string",
  mode: "string",
  step: "string",
  sealed: "boolean",
  shipped: "boolean",
  turn: "number",
  iat: "number",
  exp: "number",
  jti: "string",
} as const;

export function signSession(state: SessionState, now: number = Date.now()): string {
  const iat = nowSeconds(now);
  const payload: SessionPayload = {
    v: 1,
    orderId: state.orderId,
    mode: state.mode,
    step: state.step,
    sealed: state.sealed,
    shipped: state.shipped,
    turn: state.turn,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
    jti: newJti(),
  };
  return signToken("session", payload);
}

export function verifySession(token: unknown, now: number = Date.now()): VerifyResult<SessionPayload> {
  const signed = verifySignature("session", token);
  if (!signed.ok) return signed;
  const p = signed.payload;
  const schemaError = checkSchema(p, SCHEMA);
  if (schemaError) return { ok: false, reason: schemaError };
  if (p.v !== 1) return { ok: false, reason: "unsupported token version" };
  if ((p.exp as number) <= nowSeconds(now)) return { ok: false, reason: "session expired" };
  if ((p.iat as number) > (p.exp as number)) return { ok: false, reason: "invalid token times" };
  if (!(STEPS as readonly string[]).includes(p.step as string)) return { ok: false, reason: "unknown ledger step" };
  if (p.mode !== "guarded" && p.mode !== "unguarded") return { ok: false, reason: "unknown mode" };
  if (p.orderId !== ORDER_1042.id) return { ok: false, reason: "unknown order" };
  return { ok: true, payload: p as unknown as SessionPayload };
}

/** A fresh session at the first step, as SessionState. */
export function freshSessionState(mode: AgentMode): SessionState {
  return { orderId: ORDER_1042.id, mode, step: STEPS[0], sealed: false, shipped: false, turn: 0 };
}

/** Rebuilds a PackSession from verified token state. A shipped session's ledger is COMPLETE. */
export function sessionFromState(state: Pick<SessionState, "step" | "sealed" | "shipped">): PackSession {
  const ledger = state.shipped && state.step === "SHIP" ? completedLedger() : ledgerAtStep(state.step);
  return { ledger, sealed: state.sealed, shipped: state.shipped, log: [] };
}
