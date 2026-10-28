import { describe, expect, it, vi } from "vitest";
import type { TurnRecord } from "../agent/types";
import { AgentApiError, agentSawOf, agentSawText, requestShip, scrub, sendTurn, startSession, SHIP_URL, TURN_URL } from "./agent-api";

const TOKEN = "eyJ2IjoxLCJvcmRlcklkIjoiT1JERVItMTA0MiJ9.c2lnbmF0dXJlLW5vdC1yZWFsLXNpZ25hdHVyZS1ub3QtcmVhbA";
const APPROVAL = "eyJ2IjoxLCJ0eXBlIjoiYXBwcm92YWwifQ.YXBwcm92YWwtc2lnbmF0dXJlLW5vdC1yZWFsLWFwcHJvdmFs";
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
  );
}

async function turnError(fetchImpl: typeof fetch): Promise<AgentApiError> {
  try {
    await sendTurn({ mode: "guarded", token: TOKEN, image: JPEG }, fetchImpl);
  } catch (err) {
    if (err instanceof AgentApiError) return err;
    throw err;
  }
  throw new Error("expected sendTurn to throw");
}

const OK_TURN = {
  turn: { turn: 1, step: "VERIFY_MUG", guard: { decision: "ALLOW", reason: "Verified VERIFY_MUG" } },
  session: TOKEN,
  ledger: { step: "VERIFY_NOTEBOOK", stepIndex: 1, status: "IN_PROGRESS" },
  shipped: false,
  sources: { sam: "mock", voice: "unavailable", vision: "mock", spark: "mock" },
};

describe("sendTurn", () => {
  it("posts the server's multipart field names and returns the body", async () => {
    const fetchImpl = reply(200, OK_TURN);
    const audio = new Blob([new Uint8Array(12)], { type: "audio/wav" });
    const res = await sendTurn({ mode: "guarded", token: TOKEN, image: JPEG, audio }, fetchImpl);
    expect(res.ledger.step).toBe("VERIFY_NOTEBOOK");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURN_URL);
    const form = init?.body as FormData;
    expect(form.get("mode")).toBe("guarded");
    expect(form.get("session")).toBe(TOKEN);
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect(Array.from(form.keys()).sort()).toEqual(["audio", "image", "mode", "session"]);
  });

  it("omits session on the first turn", async () => {
    const fetchImpl = reply(200, OK_TURN);
    await sendTurn({ ...startSession("unguarded"), image: JPEG }, fetchImpl);
    expect((fetchImpl.mock.calls[0][1]?.body as FormData).has("session")).toBe(false);
  });

  it("maps 400 mode mismatch and plain 400", async () => {
    const mismatch = await turnError(reply(400, { error: "Session mode mismatch", reason: "session was started in unguarded mode" }));
    expect(mismatch.kind).toBe("mode-mismatch");
    expect(mismatch.serverReason).toBe("session was started in unguarded mode");
    const bad = await turnError(reply(400, { error: "image must be PNG, JPEG or WebP" }));
    expect(bad.kind).toBe("bad-request");
    expect(bad.message).toBe("image must be PNG, JPEG or WebP");
  });

  it("maps 401 to session-invalid", async () => {
    const err = await turnError(reply(401, { error: "Invalid session", reason: "session expired" }));
    expect(err.kind).toBe("session-invalid");
    expect(err.status).toBe(401);
  });

  it("maps 429 with Retry-After", async () => {
    const err = await turnError(reply(429, { error: "Too many requests" }, { "Retry-After": "17" }));
    expect(err.kind).toBe("rate-limited");
    expect(err.retryAfter).toBe(17);
    expect(err.message).toContain("17 s");
  });

  it("maps 429 daily budget separately", async () => {
    const err = await turnError(reply(429, { error: "Daily live budget exhausted" }));
    expect(err.kind).toBe("budget-exhausted");
    expect(err.retryAfter).toBeUndefined();
  });

  it("maps 503 and 500", async () => {
    expect((await turnError(reply(503, { error: "Session signing is not configured" }))).kind).toBe("unavailable");
    expect((await turnError(reply(500, { error: "Agent turn failed", reason: "Error" }))).kind).toBe("server");
  });

  it("maps a network failure", async () => {
    const err = await turnError(vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    }));
    expect(err.kind).toBe("network");
    expect(err.status).toBeNull();
  });

  it("rejects a malformed 200 body", async () => {
    expect((await turnError(reply(200, { turn: "nope" }))).kind).toBe("bad-response");
  });

  it("never puts the token in error messages, even if the server echoes it", async () => {
    const statuses = [400, 401, 403, 429, 500, 503];
    for (const status of statuses) {
      const err = await turnError(reply(status, { error: `bad ${TOKEN}`, reason: `token=${TOKEN}` }));
      expect(err.message).not.toContain(TOKEN);
      expect(err.serverReason ?? "").not.toContain(TOKEN);
      expect(JSON.stringify(err)).not.toContain(TOKEN);
      expect(String(err.stack)).not.toContain(TOKEN);
    }
  });
});

describe("requestShip", () => {
  it("posts JSON { approval } to the ship route", async () => {
    const fetchImpl = reply(200, {
      shipment: { shipmentId: "SHP-1", orderId: "ORDER-1042", createdAt: "2026-10-28T00:00:00.000Z" },
      alreadyShipped: true,
    });
    const res = await requestShip({ approval: APPROVAL }, fetchImpl);
    expect(res.alreadyShipped).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SHIP_URL);
    expect(JSON.parse(String(init?.body))).toEqual({ approval: APPROVAL });
  });

  it("maps 403 and scrubs the approval", async () => {
    try {
      await requestShip({ approval: APPROVAL }, reply(403, { error: "Approval rejected", reason: `expired ${APPROVAL}` }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentApiError);
      const e = err as AgentApiError;
      expect(e.kind).toBe("approval-rejected");
      expect(`${e.message} ${e.serverReason}`).not.toContain(APPROVAL);
    }
  });
});

describe("scrub", () => {
  it("removes given secrets and long token-like strings", () => {
    expect(scrub(`x ${TOKEN} y`)).toBe("x [token] y");
    expect(scrub("short reason")).toBe("short reason");
  });
});

describe("agentSawOf / agentSawText", () => {
  const turnWith = (agentSaw: unknown) => ({ perception: { agentSaw } }) as unknown as TurnRecord;

  it("formats the detected objects given to the agent", () => {
    const turn = turnWith([
      { label: "red mug", confidence: 0.95 },
      { label: "banana", confidence: 0.6 },
    ]);
    expect(agentSawText(turn)).toBe("red mug 0.95, banana 0.60");
  });

  it("is (nothing) for an empty, missing or malformed list", () => {
    expect(agentSawText(turnWith([]))).toBe("(nothing)");
    expect(agentSawText({} as TurnRecord)).toBe("(nothing)");
    expect(agentSawText(turnWith("red mug"))).toBe("(nothing)");
    expect(agentSawOf(turnWith([{ label: 1, confidence: 0.9 }, { label: "x", confidence: NaN }, null]))).toEqual([]);
  });
});
