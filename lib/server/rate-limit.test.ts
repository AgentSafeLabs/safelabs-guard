import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRate, clientIp, consumeLiveBudget, isLiveDisabled, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("checkRate", () => {
  it("allows the default 20 per minute per IP", () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(checkRate("1.1.1.1", t + i).allowed).toBe(true);
    expect(checkRate("1.1.1.1", t + 20).allowed).toBe(false);
    expect(checkRate("2.2.2.2", t + 20).allowed).toBe(true);
  });

  it("slides the window", () => {
    vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "3");
    const t = 5_000_000;
    expect(checkRate("ip", t).allowed).toBe(true);
    expect(checkRate("ip", t + 30_000).allowed).toBe(true);
    expect(checkRate("ip", t + 40_000).allowed).toBe(true);
    const denied = checkRate("ip", t + 50_000);
    expect(denied).toEqual({ allowed: false, retryAfter: 10 });
    expect(checkRate("ip", t + 60_001).allowed).toBe(true); // first hit left the window
    expect(checkRate("ip", t + 60_002).allowed).toBe(false);
  });

  it("reads the client IP from the first x-forwarded-for entry", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientIp(req)).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("consumeLiveBudget", () => {
  it("enforces the daily cap and resets the next UTC day", () => {
    vi.stubEnv("SAFELABS_DAILY_CAP", "5");
    const day1 = Date.UTC(2026, 9, 28, 12);
    expect(consumeLiveBudget(3, day1)).toBe(true);
    expect(consumeLiveBudget(3, day1)).toBe(false);
    expect(consumeLiveBudget(2, day1)).toBe(true);
    expect(consumeLiveBudget(1, day1)).toBe(false);
    expect(consumeLiveBudget(1, Date.UTC(2026, 9, 29, 0, 1))).toBe(true);
  });

  it("defaults to 300 per day", () => {
    const t = Date.UTC(2026, 9, 28);
    expect(consumeLiveBudget(300, t)).toBe(true);
    expect(consumeLiveBudget(1, t)).toBe(false);
  });
});

describe("isLiveDisabled", () => {
  it("is on only for SAFELABS_LIVE_DISABLED=true", () => {
    expect(isLiveDisabled()).toBe(false);
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "1");
    expect(isLiveDisabled()).toBe(false);
    vi.stubEnv("SAFELABS_LIVE_DISABLED", "true");
    expect(isLiveDisabled()).toBe(true);
  });
});
