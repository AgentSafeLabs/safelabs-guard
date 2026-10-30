// Origin check for the billed and state-changing POST routes.
//
// WHAT THIS DOES: in production a browser request is accepted only when its
// Origin is on the allowlist (or, with no Origin, Sec-Fetch-Site is
// "same-origin"). That stops OTHER WEBSITES from using their visitors' browsers
// (and those visitors' IP addresses) to call the paid routes.
//
// WHAT THIS DOES NOT DO: stop a scripted client. curl, a Python script or a
// bot can send any Origin header it likes. Against those the defence is the
// per-IP limit, the daily budget and the kill switch, and those are only
// per-instance until they move to a shared store (see REPORT.md, F-01).
//
// Allowlist: SAFELABS_ALLOWED_ORIGINS (comma-separated origins). Default:
// https://guard.agentsafelabs.com. This deployment's own Vercel hosts
// (VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL) are always
// added so previews work. Outside production, localhost origins and requests
// with no Origin are also accepted.

import { isProduction } from "./runtime-mode";

type Env = Record<string, string | undefined>;

export const DEFAULT_ALLOWED_ORIGIN = "https://guard.agentsafelabs.com";
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function toOrigin(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
}

export function allowedOrigins(env: Env = process.env): Set<string> {
  const configured = (env.SAFELABS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const value of configured.length > 0 ? configured : [DEFAULT_ALLOWED_ORIGIN]) {
    const origin = toOrigin(value);
    if (origin) out.add(origin);
  }
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = host ? toOrigin(host) : null;
    if (origin) out.add(origin);
  }
  return out;
}

/** null = fine; otherwise a 403 the route returns before reading the body. */
export function rejectBadOrigin(request: Request, env: Env = process.env): Response | null {
  const production = isProduction(env);
  const origin = request.headers.get("origin");
  let ok: boolean;
  if (origin !== null) {
    ok = allowedOrigins(env).has(origin) || (!production && LOCALHOST.test(origin));
  } else {
    ok = production ? request.headers.get("sec-fetch-site") === "same-origin" : true;
  }
  return ok ? null : Response.json({ error: "Forbidden" }, { status: 403 });
}
