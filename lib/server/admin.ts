// Admin gate for actions that spend Meta budget outside a user turn
// (GET /api/meta/status?probe=1). The caller must send header
// x-safelabs-admin equal to SAFELABS_ADMIN_TOKEN. Unset or empty env = no admin.

import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_HEADER = "x-safelabs-admin";

type Env = Record<string, string | undefined>;

/**
 * Constant-time compare. Both sides are hashed first so the comparison does
 * not depend on (or leak) the token's length.
 */
export function isAdminRequest(request: Request, env: Env = process.env): boolean {
  const expected = env.SAFELABS_ADMIN_TOKEN;
  const given = request.headers.get(ADMIN_HEADER);
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
