import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ship } from "../../app/api/packproof/ship/route";
import { POST as turn } from "../../app/api/agent/turn/route";
import { resetRateLimits } from "./rate-limit";

// Route wiring for lib/server/runtime-mode.ts: production refuses mock perception.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SAFELABS_TOKEN_SECRET", "test-secret-not-real-0123456789abcdef");
  vi.stubEnv("SAFELABS_ALLOW_MOCK_IN_PRODUCTION", "");
  vi.stubEnv("SAFELABS_LIVE_DISABLED", "");
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function turnRequest(): Request {
  const form = new FormData();
  form.append("mode", "guarded");
  return new Request("http://localhost/api/agent/turn", { method: "POST", body: form });
}

function shipRequest(): Request {
  return new Request("http://localhost/api/packproof/ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approval: "x.y" }),
  });
}

describe("production runtime guard on the agent routes", () => {
  it("503s both routes in production with mock mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFELABS_USE_MOCKS", "true");
    for (const res of [await turn(turnRequest()), await ship(shipRequest())]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Agent is not configured for production",
        reason: expect.stringContaining("SAFELABS_USE_MOCKS=false"),
      });
    }
  });

  it("503s in production when the kill switch is on", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SAFELABS_USE_MOCKS", "false");
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    expect((await turn(turnRequest())).status).toBe(503);
  });

  it("lets the explicit override through to the handler", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFELABS_USE_MOCKS", "true");
    vi.stubEnv("SAFELABS_ALLOW_MOCK_IN_PRODUCTION", "true");
    expect((await ship(shipRequest())).status).toBe(403); // handler ran and rejected the fake approval
  });

  it("does not interfere outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SAFELABS_USE_MOCKS", "true");
    expect((await turn(turnRequest())).status).toBe(200);
  });
});
