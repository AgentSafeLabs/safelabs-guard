import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/meta/status/route";
import { ADMIN_HEADER, isAdminRequest } from "./admin";
import { FAKE_KEY } from "./meta-stub.test-helpers";

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
  ])("probe=1 with %s is ignored: no Meta call", async (_label, header) => {
    const res = await call(statusRequest("?probe=1", header));
    expect(res.status).toBe(200);
    expect(res.body.probe).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probe=1 is ignored when SAFELABS_ADMIN_TOKEN is unset, even with a header", async () => {
    vi.stubEnv("SAFELABS_ADMIN_TOKEN", "");
    const res = await call(statusRequest("?probe=1", ""));
    expect(res.body.probe).toBeUndefined();
    const again = await call(statusRequest("?probe=1", "anything"));
    expect(again.body.probe).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
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
