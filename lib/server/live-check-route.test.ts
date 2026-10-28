import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/guard/live-check/route";
import { FAKE_KEY, PNG, WAV } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";

// H7: the old billed route shares the agent routes' limits. Fetch is stubbed;
// any Meta call made where a refusal was expected fails the test.
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function samStream(): Response {
  const raw = [
    { type: "response.output_text.delta", delta: "<|box;1,2,3,4|>" },
    { type: "response.completed", response: {} },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(raw, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function request(fields: { image?: Uint8Array; imageType?: string; audio?: Uint8Array; ip?: string } = {}): Request {
  const form = new FormData();
  form.append("image", new File([Buffer.from(fields.image ?? PNG)], "photo.png", { type: fields.imageType ?? "image/png" }));
  form.append("claimedObject", "red mug");
  if (fields.audio) form.append("audio", new File([Buffer.from(fields.audio)], "a.wav", { type: "audio/wav" }));
  return new Request("http://localhost/api/guard/live-check", {
    method: "POST",
    body: form,
    headers: { "x-real-ip": fields.ip ?? "203.0.113.7" },
  });
}

async function call(req: Request) {
  const res = await POST(req);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: JSON.parse(text) };
}

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/files")) return json({ id: "file-1" });
    if (url.endsWith("/responses")) return samStream();
    if (url.includes("/asr/transcribe")) return json({ transcript: "confirmed", turns: [] });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SAFELABS_USE_MOCKS", "false");
  vi.stubEnv("SAFELABS_LIVE_DISABLED", "");
  vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "");
  vi.stubEnv("SAFELABS_DAILY_CAP", "");
  vi.stubEnv("META_SAM_API_KEY", FAKE_KEY);
  vi.stubEnv("META_VOICE_API_KEY", FAKE_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("live-check: per-IP rate limit", () => {
  it("429 with Retry-After and a BLOCK decision, before any Meta call", async () => {
    vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "1");
    expect((await call(request())).status).toBe(200);
    fetchMock.mockClear();

    const res = await call(request());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.body).toMatchObject({ decision: "BLOCK", error: "Too many requests" });
    expect(fetchMock).not.toHaveBeenCalled();

    // A different client is not affected.
    expect((await call(request({ ip: "198.51.100.1" }))).status).toBe(200);
  });
});

describe("live-check: daily budget", () => {
  it("429 BLOCK with Retry-After once the cap is spent (SAM = 2 calls)", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "2");
    expect((await call(request())).status).toBe(200);
    fetchMock.mockClear();
    const res = await call(request());
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ decision: "BLOCK", error: "Daily live budget exhausted" });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts the voice call too", async () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "2");
    expect((await call(request({ audio: WAV }))).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("live-check: kill switch", () => {
  it("503 BLOCK and no Meta call", async () => {
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    const res = await call(request());
    expect(res.status).toBe(503);
    expect(res.body.decision).toBe("BLOCK");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("live-check: body and content checks", () => {
  it("413 for a body over 8 MB, no Meta call", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG.subarray(0, 8));
    const res = await call(request({ image: big }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("413 from Content-Length alone, without reading the body", async () => {
    const req = new Request("http://localhost/api/guard/live-check", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(9 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" },
    });
    expect((await POST(req)).status).toBe(413);
  });

  it("400 for non-image bytes labelled image/png, no Meta call", async () => {
    const res = await call(request({ image: new Uint8Array(Buffer.from("<html>not an image</html>")) }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("image must be PNG, JPEG or WebP");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a valid request still reaches reconcile and never echoes the key", async () => {
    const res = await call(request());
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("ALLOW");
    expect(res.text).not.toContain(FAKE_KEY);
  });
});
