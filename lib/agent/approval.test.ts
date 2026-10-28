import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signApproval, verifyApproval, type ShipAllowance } from "./approval";
import { signSession, freshSessionState } from "./session-token";
import { signToken } from "./signing";

const ALLOW: ShipAllowance = { mode: "guarded", step: "SHIP", proposedAction: "SHIP", decision: "ALLOW" };

beforeEach(() => vi.stubEnv("SAFELABS_TOKEN_SECRET", "test-secret-not-real-0123456789abcdef"));
afterEach(() => vi.unstubAllEnvs());

function decode(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

describe("approval tokens", () => {
  it("round-trips for the right order", () => {
    const result = verifyApproval(signApproval("ORDER-1042", ALLOW));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.exp - result.payload.iat).toBe(5 * 60);
  });

  it("is only issued for an ALLOWed guarded SHIP at the SHIP step", () => {
    const bad = [
      { ...ALLOW, mode: "unguarded" },
      { ...ALLOW, step: "SEAL" },
      { ...ALLOW, proposedAction: "SEAL" },
      { ...ALLOW, decision: "BLOCK" },
    ];
    for (const allowance of bad) {
      expect(() => signApproval("ORDER-1042", allowance as unknown as ShipAllowance)).toThrow();
    }
  });

  it("rejects a forged token", () => {
    const [body] = signApproval("ORDER-1042", ALLOW).split(".");
    expect(verifyApproval(`${body}.${"A".repeat(43)}`)).toEqual({ ok: false, reason: "bad signature" });
    expect(verifyApproval(signSession(freshSessionState("guarded")))).toEqual({ ok: false, reason: "bad signature" });
  });

  it("rejects an expired token", () => {
    const old = signApproval("ORDER-1042", ALLOW, Date.now() - 6 * 60 * 1000);
    expect(verifyApproval(old)).toEqual({ ok: false, reason: "approval expired" });
  });

  it("rejects a wrong action or type", () => {
    const payload = decode(signApproval("ORDER-1042", ALLOW));
    expect(verifyApproval(signToken("approval", { ...payload, action: "SEAL" }))).toEqual({
      ok: false,
      reason: "approval is not for SHIP",
    });
    expect(verifyApproval(signToken("approval", { ...payload, type: "session" }))).toEqual({
      ok: false,
      reason: "not an approval token",
    });
  });

  it("rejects a token for a different order", () => {
    expect(verifyApproval(signApproval("ORDER-9999", ALLOW))).toEqual({
      ok: false,
      reason: "approval is for a different order",
    });
  });
});
