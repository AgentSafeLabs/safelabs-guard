// Typed browser client for our own routes only:
//   POST /api/agent/turn       (multipart: mode, session?, image?, audio?)
//   POST /api/packproof/ship   (JSON: { approval })
// Shapes follow lib/server/agent-turn.ts and lib/server/ship.ts. Tokens live
// in memory only and never appear in errors or logs.

import type { PerceptionDetail } from "../agent/perception-detail";
import type { SecurityEvent } from "../agent/security-events";
import type { AgentMode, DetectedObject, TurnRecord } from "../agent/types";
import type { SourceLabel, SourceName } from "../server/agent-turn";
import type { ShipmentRecord } from "../server/ship";

export const TURN_URL = "/api/agent/turn";
export const SHIP_URL = "/api/packproof/ship";

export interface ClientSession {
  mode: AgentMode;
  /** null until the first turn: the server then creates a session at VERIFY_MUG. */
  token: string | null;
}

export interface TurnResponse {
  turn: TurnRecord;
  session: string;
  ledger: { step: TurnRecord["step"]; stepIndex: number; status: "IN_PROGRESS" | "COMPLETE" };
  shipped: boolean;
  sources: { sam: SourceLabel; voice: SourceLabel; vision: SourceLabel; spark: SourceLabel };
  /** Fixed, non-secret reason per unavailable source (e.g. "ocr timeout", "voice not sent"). */
  perceptionDetail?: Partial<Record<SourceName, PerceptionDetail>>;
  /** Injection attempts the guard detected (shadow: true in unguarded mode). Display only. */
  securityEvents?: SecurityEvent[];
  /** Present only when the guard ALLOWed SHIP at the SHIP step. */
  approval?: string;
}

export interface ShipResponse {
  shipment: ShipmentRecord;
  /** Neutral: the server is stateless and cannot tell a first call from a repeat. */
  status: "shipment";
}

export type AgentApiErrorKind =
  | "bad-request"
  | "mode-mismatch"
  | "session-invalid"
  | "approval-rejected"
  | "rate-limited"
  | "budget-exhausted"
  | "unavailable"
  | "server"
  | "network"
  | "bad-response";

export class AgentApiError extends Error {
  constructor(
    readonly kind: AgentApiErrorKind,
    message: string,
    readonly status: number | null,
    /** Server's reason string, sanitized. */
    readonly serverReason?: string,
    /** Seconds, from Retry-After when the server sent it. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

/** A new local session. There is no start endpoint: the first turn without a token starts one. */
export function startSession(mode: AgentMode): ClientSession {
  return { mode, token: null };
}

/** Removes any of `secrets` and any long token-like run from server text. */
export function scrub(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[token]");
  return out.replace(/[A-Za-z0-9_-]{40,}(?:\.[A-Za-z0-9_-]{20,})?/g, "[token]").slice(0, 200);
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await res.json()) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toError(res: Response, body: Record<string, unknown> | null, route: "turn" | "ship", secrets: (string | null | undefined)[]) {
  const error = typeof body?.error === "string" ? scrub(body.error, secrets) : "";
  const reason = typeof body?.reason === "string" ? scrub(body.reason, secrets) : undefined;
  const detail = reason ?? (error || undefined);
  const s = res.status;
  if (s === 400 && error === "Session mode mismatch") {
    return new AgentApiError("mode-mismatch", "This session belongs to the other mode. Start a new run.", s, detail);
  }
  if (s === 400) return new AgentApiError("bad-request", error || "The server rejected the request.", s, detail);
  if (s === 401) {
    return new AgentApiError("session-invalid", "The session expired or is invalid. Start a new run.", s, detail);
  }
  if (s === 403) {
    return new AgentApiError("approval-rejected", "The ship approval was rejected (missing, expired or invalid).", s, detail);
  }
  if (s === 429 && error === "Daily live budget exhausted") {
    return new AgentApiError("budget-exhausted", "Today's live perception budget is used up. Try again tomorrow.", s, detail);
  }
  if (s === 429) {
    const wait = retryAfterSeconds(res);
    const msg = wait !== undefined ? `Too many requests. Try again in ${wait} s.` : "Too many requests. Wait a moment.";
    return new AgentApiError("rate-limited", msg, s, detail, wait);
  }
  if (s === 503) {
    return new AgentApiError(
      "unavailable",
      route === "turn" ? "The agent service is not configured right now." : "Shipping is not configured right now.",
      s,
      detail,
      retryAfterSeconds(res),
    );
  }
  return new AgentApiError("server", `The server failed (HTTP ${s}).`, s, detail);
}

function isTurnResponse(body: Record<string, unknown> | null): body is Record<string, unknown> & TurnResponse {
  if (!body) return false;
  const turn = body.turn as Record<string, unknown> | undefined;
  const ledger = body.ledger as Record<string, unknown> | undefined;
  const sources = body.sources as Record<string, unknown> | undefined;
  return (
    typeof body.session === "string" &&
    typeof body.shipped === "boolean" &&
    typeof turn === "object" && turn !== null && typeof turn.step === "string" &&
    typeof ledger === "object" && ledger !== null && typeof ledger.step === "string" &&
    typeof sources === "object" && sources !== null &&
    (body.approval === undefined || typeof body.approval === "string")
  );
}

const MAX_AGENT_SAW = 20;

/**
 * The detected objects the server gave the agent this turn, checked for shape
 * (an older or malformed reply gives []). Display only.
 */
export function agentSawOf(turn: TurnRecord): DetectedObject[] {
  const raw: unknown = (turn.perception as { agentSaw?: unknown } | undefined)?.agentSaw;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (o): o is DetectedObject =>
        typeof o === "object" && o !== null &&
        typeof (o as DetectedObject).label === "string" &&
        typeof (o as DetectedObject).confidence === "number" && Number.isFinite((o as DetectedObject).confidence),
    )
    .slice(0, MAX_AGENT_SAW)
    .map(({ label, confidence }) => ({ label: label.slice(0, 40), confidence }));
}

/** "red mug 0.95, banana 0.61", or "(nothing)". */
export function agentSawText(turn: TurnRecord): string {
  const seen = agentSawOf(turn);
  return seen.length ? seen.map((o) => `${o.label} ${o.confidence.toFixed(2)}`).join(", ") : "(nothing)";
}

export interface SendTurnInput {
  mode: AgentMode;
  token: string | null;
  image: Blob | null;
  audio?: Blob | null;
}

export async function sendTurn(input: SendTurnInput, fetchImpl: typeof fetch = fetch): Promise<TurnResponse> {
  const form = new FormData();
  form.append("mode", input.mode);
  if (input.token) form.append("session", input.token);
  if (input.image) form.append("image", input.image, "frame.jpg");
  if (input.audio) form.append("audio", input.audio, "clip.wav");

  let res: Response;
  try {
    res = await fetchImpl(TURN_URL, { method: "POST", body: form });
  } catch {
    throw new AgentApiError("network", "Could not reach the server. Check your connection.", null);
  }
  const body = await readJson(res);
  if (!res.ok) throw toError(res, body, "turn", [input.token]);
  if (!isTurnResponse(body)) throw new AgentApiError("bad-response", "The server sent an unexpected reply.", res.status);
  return body;
}

export async function requestShip(input: { approval: string }, fetchImpl: typeof fetch = fetch): Promise<ShipResponse> {
  let res: Response;
  try {
    res = await fetchImpl(SHIP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval: input.approval }),
    });
  } catch {
    throw new AgentApiError("network", "Could not reach the server. Check your connection.", null);
  }
  const body = await readJson(res);
  if (!res.ok) throw toError(res, body, "ship", [input.approval]);
  const shipment = body?.shipment as Record<string, unknown> | undefined;
  if (!shipment || typeof shipment.shipmentId !== "string" || body?.status !== "shipment") {
    throw new AgentApiError("bad-response", "The server sent an unexpected reply.", res.status);
  }
  return body as unknown as ShipResponse;
}
