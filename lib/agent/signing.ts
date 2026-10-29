// HMAC-SHA256 token plumbing shared by session and approval tokens.
// Format: base64url(JSON payload).base64url(signature). The signature covers
// a per-kind prefix, so a session token can never verify as an approval.
//
// Secret: env SAFELABS_TOKEN_SECRET (never logged or returned). When it is
// missing, non-production uses one ephemeral in-process secret (warned once);
// production refuses to sign or verify.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenKind = "session" | "approval";

export class TokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenConfigError";
  }
}

export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: string };

const MIN_SECRET_LENGTH = 32;
let ephemeralSecret: string | null = null;

function secret(): string {
  const configured = process.env.SAFELABS_TOKEN_SECRET;
  const production = process.env.NODE_ENV === "production";
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (production) {
    throw new TokenConfigError(
      `SAFELABS_TOKEN_SECRET must be set (at least ${MIN_SECRET_LENGTH} characters) in production`,
    );
  }
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("base64url");
    console.warn(
      "SAFELABS_TOKEN_SECRET is missing or short; using an ephemeral in-process secret. Tokens will not survive a restart.",
    );
  }
  return ephemeralSecret;
}

function mac(kind: TokenKind, body: string): Buffer {
  return createHmac("sha256", secret()).update(`safelabs.${kind}.v1.${body}`).digest();
}

export function nowSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1000);
}

export function newJti(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Deterministic, domain-separated HMAC-SHA256 under the token secret. Same
 * inputs give the same bytes on every instance that shares the secret; the
 * output reveals nothing about the secret. Used for stateless derived ids.
 */
export function deriveId(label: string, parts: readonly string[]): Buffer {
  return createHmac("sha256", secret()).update(`safelabs.derive.v1.${JSON.stringify([label, ...parts])}`).digest();
}

export function signToken(kind: TokenKind, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(kind, body).toString("base64url")}`;
}

/**
 * Checks shape and signature (constant time) and returns the parsed JSON.
 * Schema, version and expiry checks are the caller's.
 */
export function verifySignature(kind: TokenKind, token: unknown): VerifyResult<Record<string, unknown>> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "token must be a non-empty string" };
  }
  const parts = token.split(".");
  const b64url = /^[A-Za-z0-9_-]+$/;
  if (parts.length !== 2 || !b64url.test(parts[0]) || !b64url.test(parts[1])) {
    return { ok: false, reason: "malformed token" };
  }
  const [body, sig] = parts;
  const expected = mac(kind, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad signature" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed payload" };
  }
  return { ok: true, payload: parsed as Record<string, unknown> };
}

type FieldType = "string" | "number" | "boolean";

/** Exact key set and primitive types; numbers must be non-negative integers. */
export function checkSchema(payload: Record<string, unknown>, schema: Record<string, FieldType>): string | null {
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!(key in schema)) return `unknown field: ${key}`;
  }
  for (const [key, type] of Object.entries(schema)) {
    const value = payload[key];
    if (typeof value !== type) return `field ${key} must be a ${type}`;
    if (type === "number" && !(Number.isSafeInteger(value) && (value as number) >= 0)) {
      return `field ${key} must be a non-negative integer`;
    }
  }
  return null;
}
