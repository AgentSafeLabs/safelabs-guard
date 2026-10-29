// Stateless ship idempotency: the shipment is a pure function of the verified
// approval, so repeats and separate instances agree. Needs the patch in
// docs/audit/ship-idempotency.patch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShipAllowance } from "../agent/approval";

const SECRET = "test-secret-not-real-0123456789abcdef";
const ALLOW: ShipAllowance = { mode: "guarded", step: "SHIP", proposedAction: "SHIP", decision: "ALLOW" };

beforeEach(() => {
  vi.stubEnv("SAFELABS_TOKEN_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** A fresh module graph: what a cold serverless instance would load. */
async function instance() {
  vi.resetModules();
  const [approval, ship, limits] = await Promise.all([
    import("../agent/approval"),
    import("./ship"),
    import("./rate-limit"),
  ]);
  limits.resetRateLimits();
  return {
    sign: approval.signApproval,
    async call(body: unknown) {
      const res = await ship.handleShip(
        new Request("http://localhost/api/packproof/ship", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return { status: res.status, text: await res.clone().text(), body: await res.json() };
    },
  };
}

describe("stateless ship idempotency", () => {
  it("same approval twice: identical id and timestamp", async () => {
    const a = await instance();
    const approval = a.sign("ORDER-1042", ALLOW);
    const first = await a.call({ approval });
    const second = await a.call({ approval });
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.shipment.shipmentId).toMatch(/^SHP-[0-9A-F]{12}$/);
    expect(first.body.status).toBe("shipment");
    expect(first.body).not.toHaveProperty("alreadyShipped");
  });

  it("createdAt is the approval's iat, not the wall clock", async () => {
    const a = await instance();
    const issuedAt = Date.now() - 2 * 60_000;
    const approval = a.sign("ORDER-1042", ALLOW, issuedAt);
    const res = await a.call({ approval });
    expect(res.body.shipment.createdAt).toBe(new Date(Math.floor(issuedAt / 1000) * 1000).toISOString());
  });

  it("two instances with fresh module state agree", async () => {
    const one = await instance();
    const approval = one.sign("ORDER-1042", ALLOW);
    const first = await one.call({ approval });
    const two = await instance();
    const second = await two.call({ approval });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("different approvals give different ids", async () => {
    const a = await instance();
    const x = await a.call({ approval: a.sign("ORDER-1042", ALLOW) });
    const y = await a.call({ approval: a.sign("ORDER-1042", ALLOW) });
    expect(x.body.shipment.shipmentId).not.toBe(y.body.shipment.shipmentId);
  });

  it("the id depends on the secret", async () => {
    await instance();
    const { shipmentFor } = await import("./ship");
    const claims = { orderId: "ORDER-1042", jti: "same-jti", iat: 1_800_000_000 };
    const withFirst = shipmentFor(claims);
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "another-secret-not-real-0123456789ab");
    expect(shipmentFor(claims).shipmentId).not.toBe(withFirst.shipmentId);
  });

  it("refuses tampered, expired, wrong-order and non-string approvals", async () => {
    const a = await instance();
    const valid = a.sign("ORDER-1042", ALLOW);
    const [body] = valid.split(".");

    expect((await a.call({ approval: `${body}.${"A".repeat(43)}` })).status).toBe(403);

    const flipped = Buffer.from(body, "base64url").toString("utf8").replace("ORDER-1042", "ORDER-9999");
    const forged = `${Buffer.from(flipped).toString("base64url")}.${valid.split(".")[1]}`;
    expect((await a.call({ approval: forged })).status).toBe(403);

    const expired = await a.call({ approval: a.sign("ORDER-1042", ALLOW, Date.now() - 6 * 60_000) });
    expect(expired.status).toBe(403);
    expect(expired.body.reason).toBe("approval expired");

    const wrongOrder = await a.call({ approval: a.sign("ORDER-9999", ALLOW) });
    expect(wrongOrder.status).toBe(403);
    expect(wrongOrder.body.reason).toBe("approval is for a different order");

    expect((await a.call({})).status).toBe(403);
    expect((await a.call({ approval: 123 })).status).toBe(403);
  });

  it("refuses an approval signed under a different secret", async () => {
    const a = await instance();
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "another-secret-not-real-0123456789ab");
    const other = await instance();
    const foreign = other.sign("ORDER-1042", ALLOW);
    vi.stubEnv("SAFELABS_TOKEN_SECRET", SECRET);
    const res = await a.call({ approval: foreign });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("bad signature");
  });

  it("never puts the secret in any response, success or failure", async () => {
    const a = await instance();
    const approval = a.sign("ORDER-1042", ALLOW);
    const responses = [
      await a.call({ approval }),
      await a.call({ approval: `${approval}x` }),
      await a.call({ approval: a.sign("ORDER-9999", ALLOW) }),
      await a.call({}),
    ];
    for (const r of responses) expect(r.text).not.toContain(SECRET);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFELABS_TOKEN_SECRET", "short");
    const misconfigured = await a.call({ approval });
    expect(misconfigured.status).toBe(503);
    expect(misconfigured.text).not.toContain(SECRET);
    expect(misconfigured.text).not.toContain("short");
  });
});
