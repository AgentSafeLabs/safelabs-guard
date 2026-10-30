// Admin gate for actions that spend Meta budget outside a user turn
// (GET /api/meta/status?probe=1). The caller must send header
// x-safelabs-admin equal to SAFELABS_ADMIN_TOKEN. Unset or empty env = no admin
// (the route answers 404). Probes are also limited per instance per hour.

import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_PROBES_PER_HOUR } from "./limits";

export const ADMIN_HEADER = "x-safelabs-admin";
const HOUR_MS = 3_600_000;

type Env = Record<string, string | undefined>;

/**
 * Constant-time string compare. Both sides are hashed first so the buffers
 * are the same length and the comparison does not depend on (or leak) the
 * secret's length.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

export function isAdminRequest(request: Request, env: Env = process.env): boolean {
  const expected = env.SAFELABS_ADMIN_TOKEN;
  const given = request.headers.get(ADMIN_HEADER);
  if (!expected || !given) return false;
  return safeEqual(given, expected);
}

/** "disabled" = no admin token configured (the probe does not exist). */
export function adminState(request: Request, env: Env = process.env): "disabled" | "denied" | "ok" {
  if (!env.SAFELABS_ADMIN_TOKEN) return "disabled";
  return isAdminRequest(request, env) ? "ok" : "denied";
}

let probeTimes: number[] = [];

/** Reserves one probe in the sliding hour. Per instance, in memory (see rate-limit.ts). */
export function consumeProbeSlot(now: number = Date.now()): { allowed: boolean; retryAfter: number } {
  probeTimes = probeTimes.filter((t) => now - t < HOUR_MS);
  if (probeTimes.length >= MAX_PROBES_PER_HOUR) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((probeTimes[0] + HOUR_MS - now) / 1000)) };
  }
  probeTimes.push(now);
  return { allowed: true, retryAfter: 0 };
}

/** Tests only. */
export function resetProbeLimit(): void {
  probeTimes = [];
}
