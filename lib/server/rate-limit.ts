// Abuse limits for the billed routes (/api/agent/turn, /api/guard/live-check).
//
// BEST-EFFORT ONLY: all state lives in this process's memory, so each
// serverless instance has its own window and its own daily budget, and both
// reset on cold start. Must move to a durable shared store (PR1).
//
//   SAFELABS_RATE_LIMIT_PER_MIN  per-IP requests per sliding minute (default 20)
//   SAFELABS_DAILY_CAP           live Meta calls per UTC day, all callers (default 300)
//   SAFELABS_LIVE_DISABLED=true  kill switch: routes use mock clients and label
//                                every source "mock"

const WINDOW_MS = 60_000;
const DEFAULT_PER_MIN = 20;
const DEFAULT_DAILY_CAP = 300;
const MAX_TRACKED_IPS = 10_000;

const hits = new Map<string, number[]>();
let budgetDay = "";
let budgetUsed = 0;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

export interface RateResult {
  allowed: boolean;
  /** Seconds until a slot frees up (0 when allowed). */
  retryAfter: number;
}

export function checkRate(ip: string, now: number = Date.now()): RateResult {
  const limit = intEnv("SAFELABS_RATE_LIMIT_PER_MIN", DEFAULT_PER_MIN);
  const key = ip || "unknown";
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  hits.delete(key); // re-insert so Map order tracks recency
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_IPS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return { allowed: true, retryAfter: 0 };
}

/** Reserves `calls` live Meta calls from today's global budget. false = cap reached. */
export function consumeLiveBudget(calls = 1, now: number = Date.now()): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== budgetDay) {
    budgetDay = day;
    budgetUsed = 0;
  }
  const cap = intEnv("SAFELABS_DAILY_CAP", DEFAULT_DAILY_CAP);
  if (budgetUsed + calls > cap) return false;
  budgetUsed += calls;
  return true;
}

export function isLiveDisabled(): boolean {
  return process.env.SAFELABS_LIVE_DISABLED === "true";
}

/** Seconds until the daily budget resets (next UTC midnight); at least 1. */
export function secondsUntilBudgetReset(now: number = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * Client IP from proxy headers, most trustworthy first:
 *   1. x-vercel-forwarded-for: set by Vercel's edge, which overwrites any
 *      value the client sent.
 *   2. x-real-ip: set by the platform or reverse proxy (Vercel sets it too).
 *   3. The LAST x-forwarded-for entry: each proxy appends the address it
 *      received the request from, so the last entry was written by the proxy
 *      nearest to us. Earlier entries are whatever the client put there, so
 *      using the first one would let a caller pick a fresh IP per request and
 *      dodge the per-IP limit.
 * Still spoofable when the app runs with no proxy in front of it.
 */
export function clientIp(request: Request): string {
  const pick = (name: string) => request.headers.get(name)?.split(",")[0]?.trim();
  const last = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return pick("x-vercel-forwarded-for") || pick("x-real-ip") || last || "unknown";
}

/** Tests only: clears all in-memory counters. */
export function resetRateLimits(): void {
  hits.clear();
  budgetDay = "";
  budgetUsed = 0;
}
