// Refuses to serve the agent routes in production unless perception is live.
//
// Why: in explicit mock mode (SAFELABS_USE_MOCKS != "false") or with the kill
// switch on (SAFELABS_LIVE_DISABLED=true), lib/server/agent-turn.ts uses mock
// perception that assumes every frame shows the expected items, so any image
// ALLOWs and earns a SHIP approval. That is fine on a laptop, never on a
// public deploy. SAFELABS_ALLOW_MOCK_IN_PRODUCTION=true is the explicit,
// deliberate override (e.g. a labelled mock-only demo).
//
// Production = NODE_ENV=production OR VERCEL_ENV=production. Note that
// `next start` and Vercel preview deployments also run with
// NODE_ENV=production, so they are treated as production too.
// Pure: reads only the env object it is given.

type Env = Record<string, string | undefined>;

export interface RuntimeRefusal {
  status: 503;
  error: string;
  reason: string;
}

export interface RuntimeDescription {
  mode: "live" | "mock";
  reason: string;
}

const META_KEYS = ["META_SPARK_API_KEY", "META_SAM_API_KEY", "META_VOICE_API_KEY"] as const;

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/** null = safe to serve; otherwise a refusal the route returns as 503 JSON. */
export function assertSafeRuntime(env: Env): RuntimeRefusal | null {
  if (!isProduction(env)) return null;
  if (env.SAFELABS_ALLOW_MOCK_IN_PRODUCTION === "true") return null;
  if (env.SAFELABS_LIVE_DISABLED === "true") {
    return {
      status: 503,
      error: "Agent is disabled",
      reason: "Live perception is switched off (kill switch) and mock mode is not allowed in production.",
    };
  }
  if (env.SAFELABS_USE_MOCKS !== "false") {
    return {
      status: 503,
      error: "Agent is not configured for production",
      reason: "Mock perception is not allowed in production. Set SAFELABS_USE_MOCKS=false with live keys.",
    };
  }
  return null;
}

/** For display: whether perception will be live, and why. Never returns values, only names. */
export function describeRuntime(env: Env): RuntimeDescription {
  if (env.SAFELABS_LIVE_DISABLED === "true") return { mode: "mock", reason: "Kill switch on (SAFELABS_LIVE_DISABLED=true)." };
  if (env.SAFELABS_USE_MOCKS !== "false") {
    return {
      mode: "mock",
      reason:
        env.SAFELABS_USE_MOCKS === "true"
          ? "Mock mode on (SAFELABS_USE_MOCKS=true)."
          : "SAFELABS_USE_MOCKS is not \"false\"; clients default to mocks.",
    };
  }
  const missing = META_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    return { mode: "mock", reason: `Missing ${missing.join(", ")}; those clients fall back to mocks and guarded turns BLOCK.` };
  }
  return { mode: "live", reason: "SAFELABS_USE_MOCKS=false and all Meta keys are set." };
}

/**
 * The 503 a route returns for a refusal. The body is generic (the detail names
 * env vars and says how this deployment is configured); the detail goes to the
 * server log only.
 */
export function refusalResponse(refusal: RuntimeRefusal): Response {
  console.error(`runtime refusal: ${refusal.reason}`);
  return Response.json({ error: refusal.error, reason: "Service unavailable." }, { status: refusal.status });
}
