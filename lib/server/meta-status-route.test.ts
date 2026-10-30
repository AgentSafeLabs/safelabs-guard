import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/meta/status/route";
import { ADMIN_HEADER, adminState, consumeProbeSlot, isAdminRequest, resetProbeLimit, safeEqual } from "./admin";
import { FAKE_KEY } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";

// Mocks only: fetch is stubbed, and every probe answer is fake.
const fetchMock = vi.fn<typeof fetch>();
const ADMIN = "test-admin-token-not-real-0123456789";

function statusRequest(query: string, header?: string): Request {
  return new Request(`http://localhost/api/meta/status${query}`, {
    headers: header === undefined ? {} : { [ADMIN_HEADER]: header },
  });
}

async function call(req: Request) {
  const res = await GET(req);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

beforeEach(() => {
  resetRateLimits();
  resetProbeLimit();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SAFELABS_USE_MOCKS", "false");
  vi.stubEnv("META_SPARK_API_KEY", FAKE_KEY);
  vi.stubEnv("META_SAM_API_KEY", FAKE_KEY);
  vi.stubEnv("META_VOICE_API_KEY", FAKE_KEY);
  vi.stubEnv("SAFELABS_ADMIN_TOKEN", ADMIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/meta/status", () => {
  it("without probe: configuration only, booleans for keys, no Meta call", async () => {
    const res = await call(statusRequest(""));
    expect(res.body.probe).toBeUndefined();
    expect(res.body.spark).toEqual({ mode: "live", keySet: true });
    expect(res.text).not.toContain(FAKE_KEY);
    expect(res.text).not.toContain(FAKE_KEY.slice(0, 8));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["wrong header", "wrong-token"],
    ["prefix of the token", ADMIN.slice(0, 10)],
    ["empty header", ""],
  ])("probe=1 with %s is 403: no Meta call", async (_label, header) => {
    const res = await call(statusRequest("?probe=1", header));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probe=1 is 404 when SAFELABS_ADMIN_TOKEN is unset, even with a header", async () => {
    vi.stubEnv("SAFELABS_ADMIN_TOKEN", "");
    expect((await call(statusRequest("?probe=1", ""))).status).toBe(404);
    expect((await call(statusRequest("?probe=1", "anything"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kill switch: probe=1 is 503 before the token is even looked at; plain status still works", async () => {
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    expect((await call(statusRequest("?probe=1", ADMIN))).status).toBe(503);
    expect((await call(statusRequest("?probe=1", "wrong"))).status).toBe(503);
    expect((await call(statusRequest(""))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wrong tokens go through the per-IP limiter: 429 with Retry-After", async () => {
    vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "2");
    const req = () => statusRequest("?probe=1", "wrong");
    expect((await GET(req())).status).toBe(403);
    expect((await GET(req())).status).toBe(403);
    const limited = await GET(req());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows 3 probes per hour per instance, then 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await GET(statusRequest("?probe=1", ADMIN))).status).toBe(200);
    fetchMock.mockClear();
    const res = await GET(statusRequest("?probe=1", ADMIN));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probe spends from the daily budget (3 live clients) and stops when it is gone", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "2");
    const res = await GET(statusRequest("?probe=1", ADMIN));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probe errors are one fixed word and never upstream text", async () => {
    fetchMock.mockImplementation(async () => new Response("secret upstream body sk-abcdefghijklmnopqrstuv", { status: 500 }));
    const res = await call(statusRequest("?probe=1", ADMIN));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("upstream body");
    expect(res.text).not.toMatch(/sk-[a-z]+/);
    expect(["error", "timeout"]).toContain(res.body.probe.spark.error);
  });

  it("probe=1 with the right header probes (stubbed fetch) and never returns the key", async () => {
    const res = await call(statusRequest("?probe=1", ADMIN));
    expect(res.body.probe).toBeDefined();
    expect(fetchMock).toHaveBeenCalled();
    expect(res.text).not.toContain(FAKE_KEY);
    expect(res.text).not.toContain(ADMIN);
  });
});

describe("isAdminRequest", () => {
  it("matches only the exact token", () => {
    const env = { SAFELABS_ADMIN_TOKEN: ADMIN };
    expect(isAdminRequest(statusRequest("", ADMIN), env)).toBe(true);
    expect(isAdminRequest(statusRequest("", `${ADMIN}x`), env)).toBe(false);
    expect(isAdminRequest(statusRequest("", ADMIN.toUpperCase()), env)).toBe(false);
    expect(isAdminRequest(statusRequest(""), env)).toBe(false);
    expect(isAdminRequest(statusRequest("", ADMIN), {})).toBe(false);
  });
});

describe("admin helpers", () => {
  it("safeEqual is exact, and works for different lengths without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("adminState: disabled without a token, denied without a match, ok with it", () => {
    expect(adminState(statusRequest("", ADMIN), {})).toBe("disabled");
    expect(adminState(statusRequest(""), { SAFELABS_ADMIN_TOKEN: ADMIN })).toBe("denied");
    expect(adminState(statusRequest("", ADMIN), { SAFELABS_ADMIN_TOKEN: ADMIN })).toBe("ok");
  });

  it("consumeProbeSlot slides over one hour", () => {
    const t = 10_000_000;
    for (let i = 0; i < 3; i++) expect(consumeProbeSlot(t + i).allowed).toBe(true);
    const denied = consumeProbeSlot(t + 10);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBe(3600);
    expect(consumeProbeSlot(t + 3_600_001).allowed).toBe(true);
  });
});
