// Abuse limits for the agent routes.
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

/** Client IP from proxy headers. Spoofable unless the platform overwrites them. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Tests only: clears all in-memory counters. */
export function resetRateLimits(): void {
  hits.clear();
  budgetDay = "";
  budgetUsed = 0;
}
