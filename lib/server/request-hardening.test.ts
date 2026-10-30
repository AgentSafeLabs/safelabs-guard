import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as turn } from "../../app/api/agent/turn/route";
import { POST as liveCheck } from "../../app/api/guard/live-check/route";
import { POST as ship } from "../../app/api/packproof/ship/route";
import { encodeWav } from "../client/wav";
import { allowedOrigins, rejectBadOrigin } from "./origin";
import { MAX_AUDIO_BYTES, MAX_JSON_BODY_BYTES, MAX_TURN_BODY_BYTES } from "./limits";
import { jpegBytes, pngBytes, stubLiveEnv, turnRequest, wavBytes, webpBytes, PNG, WAV } from "./meta-stub.test-helpers";
import { resetRateLimits } from "./rate-limit";
import { inspectImage, isValidWav } from "./request-guard";

// Every fetch is stubbed and any call fails the test: all of these requests
// must be refused before a single upstream (paid) call.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("no upstream call allowed"));
  vi.stubGlobal("fetch", fetchMock);
  stubLiveEnv();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const GENERIC_ONLY = (text: string) => {
  expect(text).not.toMatch(/SAFELABS_|META_[A-Z]+_|NODE_ENV|VERCEL_|process\.env|node_modules|\bat .*:\d+:\d+|sk-[A-Za-z0-9]{8}|Bearer /);
};

function liveCheckRequest(parts: { image?: Uint8Array; audio?: Uint8Array; claim?: string; headers?: Record<string, string> }): Request {
  const form = new FormData();
  form.append("image", new File([Buffer.from(parts.image ?? PNG)], "p.png", { type: "image/png" }));
  form.append("claimedObject", parts.claim ?? "red mug");
  if (parts.audio) form.append("audio", new File([Buffer.from(parts.audio)], "a.wav", { type: "audio/wav" }));
  return new Request("http://localhost/api/guard/live-check", { method: "POST", body: form, headers: parts.headers });
}

function shipRequest(body: string, headers: Record<string, string> = { "Content-Type": "application/json" }): Request {
  return new Request("http://localhost/api/packproof/ship", { method: "POST", body, headers });
}

describe("image and audio inspection", () => {
  it("accepts PNG, JPEG and WebP with a readable header", () => {
    expect(inspectImage(pngBytes(10, 20))).toMatchObject({ ok: true, type: "image/png", width: 10, height: 20 });
    expect(inspectImage(jpegBytes(30, 40))).toMatchObject({ ok: true, type: "image/jpeg", width: 30, height: 40 });
    expect(inspectImage(webpBytes(50, 60))).toMatchObject({ ok: true, type: "image/webp", width: 50, height: 60 });
  });

  it("rejects a valid signature followed by junk, text, HTML and a giant declared canvas", () => {
    const junk = (sig: number[]) => new Uint8Array([...sig, ...Array.from({ length: 200 }, (_, i) => (i * 37) % 251)]);
    expect(inspectImage(junk([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).ok).toBe(false);
    expect(inspectImage(junk([0xff, 0xd8, 0xff])).ok).toBe(false);
    expect(inspectImage(new Uint8Array(Buffer.from("<html>x</html>"))).ok).toBe(false);
    expect(inspectImage(pngBytes(20_000, 20_000))).toEqual({ ok: false, error: "image dimensions are too large" });
    expect(inspectImage(pngBytes(0, 10)).ok).toBe(false);
  });

  it("accepts only mono 16-bit PCM WAV at 16 or 24 kHz", () => {
    expect(isValidWav(wavBytes(16_000))).toBe(true);
    expect(isValidWav(wavBytes(24_000))).toBe(true);
    expect(isValidWav(wavBytes(44_100))).toBe(false);
    expect(isValidWav(wavBytes(16_000, 2))).toBe(false);
    expect(isValidWav(wavBytes(16_000, 1, 8))).toBe(false);
    expect(isValidWav(new Uint8Array(Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.from("junkjunkjunkjunkjunk")])))).toBe(false);
    expect(isValidWav(new Uint8Array(Buffer.from("RIFF")))).toBe(false);
  });
});

describe("real files still pass (the demo must not break)", () => {
  it("every repo test image and bench image is accepted", () => {
    const dirs = [join(process.cwd(), "docs", "test-images"), join(process.cwd(), "bench", "assets", "images")];
    let count = 0;
    for (const dir of dirs) {
      for (const name of readdirSync(dir).filter((n) => /\.(png|jpe?g|webp)$/i.test(n))) {
        const result = inspectImage(new Uint8Array(readFileSync(join(dir, name))));
        expect(result.ok, name).toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("the browser recorder's WAV output is accepted", () => {
    expect(isValidWav(encodeWav(new Float32Array(16_000), 16_000))).toBe(true);
  });
});

describe("body size: 413 before any upstream call", () => {
  it("turn: Content-Length over the cap, and a streamed body over the cap", async () => {
    const declared = new Request("http://localhost/api/agent/turn", {
      method: "POST",
      body: "x",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_TURN_BODY_BYTES + 1) },
    });
    const res = await turn(declared);
    expect(res.status).toBe(413);
    GENERIC_ONLY(await res.text());

    const streamed = new Request("http://localhost/api/agent/turn", {
      method: "POST",
      body: new Uint8Array(MAX_TURN_BODY_BYTES + 1),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect((await turn(streamed)).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("live-check: over 8 MB", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG.subarray(0, 8));
    expect((await liveCheck(liveCheckRequest({ image: big }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ship: over 4 KB, by header and by stream", async () => {
    const big = JSON.stringify({ approval: "a".repeat(MAX_JSON_BODY_BYTES + 1) });
    expect((await ship(shipRequest(big))).status).toBe(413);
    const lying = shipRequest(big, { "Content-Type": "application/json", "content-length": "10" });
    expect((await ship(lying)).status).toBe(413);
    const declared = shipRequest("{}", { "Content-Type": "application/json", "content-length": String(MAX_JSON_BODY_BYTES + 1) });
    expect((await ship(declared)).status).toBe(413);
  });
});

describe("content type and shape", () => {
  it("415 for the wrong content type on all three routes", async () => {
    const json = { method: "POST", headers: { "content-type": "application/json" }, body: '{"mode":"guarded"}' };
    expect((await turn(new Request("http://localhost/api/agent/turn", json))).status).toBe(415);
    expect((await liveCheck(new Request("http://localhost/api/guard/live-check", json))).status).toBe(415);
    expect((await ship(shipRequest('{"approval":"x"}', { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await ship(shipRequest('{"approval":"x"}', {}))).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ship: 400 for invalid JSON, arrays, null and scalars", async () => {
    for (const body of ["{bad", "[]", "null", '"text"', "42", ""]) {
      const res = await ship(shipRequest(body));
      expect(res.status).toBe(400);
      GENERIC_ONLY(await res.text());
    }
  });

  it("turn and live-check: 400 for a multipart body that does not parse", async () => {
    const broken = { method: "POST", headers: { "content-type": "multipart/form-data; boundary=zzz" }, body: "not multipart" };
    expect((await turn(new Request("http://localhost/api/agent/turn", broken))).status).toBe(400);
    expect((await liveCheck(new Request("http://localhost/api/guard/live-check", broken))).status).toBe(400);
  });
});

describe("junk uploads: 400 before any upstream call", () => {
  const junkPng = new Uint8Array([...PNG.subarray(0, 8), ...Array.from({ length: 300 }, (_, i) => (i * 91) % 253)]);

  it("turn: PNG signature + junk, oversized canvas, fake WAV, long WAV", async () => {
    expect((await turn(turnRequest({ mode: "guarded", image: junkPng }))).status).toBe(400);
    expect((await turn(turnRequest({ mode: "guarded", image: pngBytes(20_000, 20_000) }))).status).toBe(400);
    const fake = new Uint8Array(Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.from("not really audio at all")]));
    const res = await turn(turnRequest({ mode: "guarded", audio: fake }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("audio must be a WAV file");
    const long = new Uint8Array(MAX_AUDIO_BYTES + 1);
    long.set(WAV.subarray(0, 44));
    expect((await turn(turnRequest({ mode: "guarded", audio: long }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("live-check: PNG signature + junk, fake WAV", async () => {
    expect((await liveCheck(liveCheckRequest({ image: junkPng }))).status).toBe(400);
    const fake = new Uint8Array(Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.from("junkjunkjunkjunkjunk")]));
    expect((await liveCheck(liveCheckRequest({ audio: fake }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Origin check", () => {
  const prod = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFELABS_ALLOWED_ORIGINS", "https://guard.example,https://other.example");
  };

  it("production: a foreign Origin is 403 on all three routes, before the body is read", async () => {
    prod();
    const headers = { Origin: "https://evil.example" };
    expect((await turn(turnRequest({ mode: "guarded", origin: "https://evil.example" }))).status).toBe(403);
    expect((await liveCheck(liveCheckRequest({ headers }))).status).toBe(403);
    expect((await ship(shipRequest("{}", { "Content-Type": "application/json", ...headers }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("production: a missing Origin is 403 unless Sec-Fetch-Site is same-origin", async () => {
    prod();
    expect((await turn(turnRequest({ mode: "guarded" }))).status).toBe(403);
    expect((await liveCheck(liveCheckRequest({}))).status).toBe(403);
    expect((await liveCheck(liveCheckRequest({ headers: { "Sec-Fetch-Site": "cross-site" } }))).status).toBe(403);
    expect((await liveCheck(liveCheckRequest({ headers: { "Sec-Fetch-Site": "same-origin" } }))).status).not.toBe(403);
    expect(await (await turn(turnRequest({ mode: "guarded" }))).text()).toBe('{"error":"Forbidden"}');
  });

  it("production: an allowlisted Origin passes the check (and the route goes on to validate)", async () => {
    prod();
    const res = await ship(shipRequest("{}", { "Content-Type": "application/json", Origin: "https://guard.example" }));
    expect(res.status).toBe(403); // reached the approval check, which rejects an empty body
    expect((await res.json()).error).toBe("Approval rejected");
  });

  it("production: localhost is not allowed", () => {
    prod();
    const req = new Request("http://localhost/x", { method: "POST", headers: { Origin: "http://localhost:3000" } });
    expect(rejectBadOrigin(req)?.status).toBe(403);
  });

  it("outside production: localhost and no Origin pass, a foreign Origin is still 403", () => {
    vi.stubEnv("NODE_ENV", "development");
    const withOrigin = (o?: string) => new Request("http://localhost/x", { method: "POST", headers: o ? { Origin: o } : {} });
    expect(rejectBadOrigin(withOrigin("http://localhost:3000"))).toBeNull();
    expect(rejectBadOrigin(withOrigin("http://127.0.0.1:3917"))).toBeNull();
    expect(rejectBadOrigin(withOrigin())).toBeNull();
    expect(rejectBadOrigin(withOrigin("https://evil.example"))?.status).toBe(403);
  });

  it("allowlist: default host, configured list, and this deployment's Vercel hosts", () => {
    vi.stubEnv("SAFELABS_ALLOWED_ORIGINS", "");
    expect([...allowedOrigins({})]).toEqual(["https://guard.agentsafelabs.com"]);
    expect([...allowedOrigins({ SAFELABS_ALLOWED_ORIGINS: " https://a.example , b.example/path " })]).toEqual(["https://a.example", "https://b.example"]);
    const withVercel = allowedOrigins({ VERCEL_URL: "guard-abc.vercel.app", VERCEL_BRANCH_URL: "guard-git-x.vercel.app" });
    expect(withVercel.has("https://guard-abc.vercel.app")).toBe(true);
    expect(withVercel.has("https://guard-git-x.vercel.app")).toBe(true);
    expect(withVercel.has("https://guard.agentsafelabs.com")).toBe(true);
  });
});

describe("kill switch is first", () => {
  it("live-check: 503 even for a bad content type and a foreign Origin", async () => {
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost/api/guard/live-check", {
      method: "POST",
      body: "x",
      headers: { "content-type": "text/plain", Origin: "https://evil.example" },
    });
    const res = await liveCheck(req);
    expect(res.status).toBe(503);
    GENERIC_ONLY(await res.text());
  });

  it("turn and ship in production: 503 before Origin and body checks, with a generic body", async () => {
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const bad = { method: "POST", body: "x", headers: { "content-type": "text/plain", Origin: "https://evil.example" } };
    for (const res of [await turn(new Request("http://localhost/api/agent/turn", bad)), await ship(new Request("http://localhost/api/packproof/ship", bad))]) {
      expect(res.status).toBe(503);
      GENERIC_ONLY(await res.text());
    }
  });
});

describe("burst", () => {
  it("12 rapid requests from one client: 429 with Retry-After from the 9th", async () => {
    vi.stubEnv("SAFELABS_ALLOWED_ORIGINS", "");
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 12; i++) {
      const res = await liveCheck(
        new Request("http://localhost/api/guard/live-check", { method: "POST", headers: { "x-real-ip": "203.0.113.50" } }),
      );
      statuses.push(res.status);
      if (res.status === 429 && !retryAfter) {
        retryAfter = res.headers.get("Retry-After");
        GENERIC_ONLY(await res.text());
      }
    }
    expect(statuses.slice(0, 8).every((s) => s === 415)).toBe(true);
    expect(statuses.slice(8).every((s) => s === 429)).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turn: same, 429 with Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) last = await turn(new Request("http://localhost/api/agent/turn", { method: "POST", headers: { "x-real-ip": "203.0.113.51" } }));
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("ship is counted separately, so a finished run can still ship after 8 turns", async () => {
    for (let i = 0; i < 8; i++) await turn(new Request("http://localhost/api/agent/turn", { method: "POST", headers: { "x-real-ip": "203.0.113.52" } }));
    const res = await ship(new Request("http://localhost/api/packproof/ship", { method: "POST", headers: { "x-real-ip": "203.0.113.52", "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(403);
  });
});
