import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signApproval } from "./approval";
import { freshSessionState, sessionFromState, signSession, verifySession, type SessionState } from "./session-token";
import { signToken, TokenConfigError } from "./signing";

const SECRET = "test-secret-not-real-0123456789abcdef";
const STATE: SessionState = { ...freshSessionState("guarded"), step: "VERIFY_CABLE", turn: 2 };

beforeEach(() => vi.stubEnv("SAFELABS_TOKEN_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

function decode(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

/** Re-signs an arbitrary payload with the real secret (to test schema checks, not signatures). */
function resign(payload: Record<string, unknown>): string {
  return signToken("session", payload);
}

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = signSession(STATE);
    const result = verifySession(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({ v: 1, orderId: "ORDER-1042", mode: "guarded", step: "VERIFY_CABLE", turn: 2 });
    expect(result.payload.exp - result.payload.iat).toBe(30 * 60);
    expect(result.payload.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it("rejects a tampered payload", () => {
    const [, sig] = signSession(STATE).split(".");
    const forged = Buffer.from(JSON.stringify({ ...decode(signSession(STATE)), step: "SHIP" })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toEqual({ ok: false, reason: "bad signature" });
  });

  it("rejects a tampered signature", () => {
    const [body, sig] = signSession(STATE).split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifySession(`${body}.${flipped}`)).toEqual({ ok: false, reason: "bad signature" });
    const wrongKey = createHmac("sha256", "other-secret").update(body).digest("base64url");
    expect(verifySession(`${body}.${wrongKey}`).ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const issued = Date.now() - 31 * 60 * 1000;
    expect(verifySession(signSession(STATE, issued))).toEqual({ ok: false, reason: "session expired" });
  });

  it("rejects a wrong version", () => {
    expect(verifySession(resign({ ...decode(signSession(STATE)), v: 2 }))).toEqual({
      ok: false,
      reason: "unsupported token version",
    });
  });

  it("rejects unknown fields and wrong types", () => {
    const payload = decode(signSession(STATE));
    expect(verifySession(resign({ ...payload, admin: true }))).toEqual({ ok: false, reason: "unknown field: admin" });
    expect(verifySession(resign({ ...payload, shipped: "false" })).ok).toBe(false);
    expect(verifySession(resign({ ...payload, turn: -1 })).ok).toBe(false);
    expect(verifySession(resign({ ...payload, step: "DONE" }))).toEqual({ ok: false, reason: "unknown ledger step" });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { jti: _jti, ...missing } = payload;
    expect(verifySession(resign(missing)).ok).toBe(false);
  });

  it("rejects non-string and malformed input", () => {
    for (const bad of [undefined, null, 42, {}, "", "nodot", "a.b.c", "a$.b"]) {
      expect(verifySession(bad).ok).toBe(false);
    }
  });

  it("does not accept an approval token as a session", () => {
    const approval = signApproval("ORDER-1042", { mode: "guarded", step: "SHIP", proposedAction: "SHIP", decision: "ALLOW" });
    expect(verifySession(approval)).toEqual({ ok: false, reason: "bad signature" });
  });

  it("refuses to sign or verify in production without a secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "");
    expect(() => signSession(STATE)).toThrow(TokenConfigError);
    expect(() => verifySession("abc.def")).toThrow(TokenConfigError);
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "too-short");
    expect(() => signSession(STATE)).toThrow(TokenConfigError);
  });

  it("uses an ephemeral secret outside production and never prints it", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = signSession(STATE);
    expect(verifySession(token).ok).toBe(true);
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    warn.mockRestore();
  });

  it("rebuilds a PackSession at the token's step", () => {
    const session = sessionFromState(STATE);
    expect(session.ledger.step).toBe("VERIFY_CABLE");
    expect(session.ledger.stepIndex).toBe(2);
    const shipped = sessionFromState({ step: "SHIP", sealed: true, shipped: true });
    expect(shipped.ledger.status).toBe("COMPLETE");
  });
});
