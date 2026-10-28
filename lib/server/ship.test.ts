import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ship } from "../../app/api/packproof/ship/route";
import { POST as turn } from "../../app/api/agent/turn/route";
import { signApproval, type ShipAllowance } from "../agent/approval";
import { stubLiveEnv, stubMeta, turnRequest, type Scene } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";
import { resetShipments } from "./ship";

const ALLOW: ShipAllowance = { mode: "guarded", step: "SHIP", proposedAction: "SHIP", decision: "ALLOW" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetRateLimits();
  resetShipments();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubLiveEnv();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function shipRequest(body: unknown): Request {
  return new Request("http://localhost/api/packproof/ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function callShip(body: unknown) {
  const res = await ship(shipRequest(body));
  return { status: res.status, body: await res.json() };
}

describe("POST /api/packproof/ship", () => {
  it("403 without an approval", async () => {
    expect((await callShip({})).status).toBe(403);
    expect((await callShip({ approval: 123 })).status).toBe(403);
    expect((await callShip("not json")).status).toBe(400);
  });

  it("403 for a forged, expired or other-order approval", async () => {
    const valid = signApproval("ORDER-1042", ALLOW);
    expect((await callShip({ approval: `${valid.split(".")[0]}.${"A".repeat(43)}` })).status).toBe(403);
    expect((await callShip({ approval: signApproval("ORDER-1042", ALLOW, Date.now() - 6 * 60_000) })).body.reason).toBe(
      "approval expired",
    );
    const other = await callShip({ approval: signApproval("ORDER-9999", ALLOW) });
    expect(other).toEqual({ status: 403, body: { error: "Approval rejected", reason: "approval is for a different order" } });
  });

  it("200 with a valid approval, and idempotent on repeat", async () => {
    const approval = signApproval("ORDER-1042", ALLOW);
    const first = await callShip({ approval });
    expect(first.status).toBe(200);
    expect(first.body.alreadyShipped).toBe(false);
    expect(first.body.shipment).toMatchObject({ orderId: "ORDER-1042", shipmentId: expect.stringMatching(/^SHP-/) });

    const second = await callShip({ approval: signApproval("ORDER-1042", ALLOW) });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ shipment: first.body.shipment, alreadyShipped: true });
  });
});

describe("guarded run end to end", () => {
  it("five guarded turns earn one approval, which ships once", async () => {
    const scenes: Scene[] = [
      { objects: ["red mug"] },
      { objects: ["red mug", "blue notebook"] },
      { objects: ["red mug", "blue notebook", "usb-c cable"] },
      { objects: ["red mug", "blue notebook", "usb-c cable"] },
      { objects: ["red mug", "blue notebook", "usb-c cable"] },
    ];
    let current = scenes[0];
    stubMeta(fetchMock, () => current);

    let session: string | undefined;
    let approval: string | undefined;
    for (let i = 0; i < scenes.length; i++) {
      current = scenes[i];
      const res = await turn(turnRequest({ mode: "guarded", session }));
      const body = await res.json();
      expect(body.turn.guard.decision).toBe("ALLOW");
      expect(Boolean(body.approval)).toBe(i === 4);
      session = body.session;
      approval = body.approval ?? approval;
    }
    expect(approval).toBeDefined();

    const res = await turn(turnRequest({ mode: "guarded", session }));
    const after = await res.json();
    expect(after.turn.guard).toEqual({ decision: "BLOCK", reason: "Order already complete" });
    expect(after.approval).toBeUndefined();

    expect((await callShip({ approval })).body.alreadyShipped).toBe(false);
    expect((await callShip({ approval })).body.alreadyShipped).toBe(true);
  });
});
