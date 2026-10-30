import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRate, clientIp, consumeLiveBudget, isLiveDisabled, resetRateLimits, secondsUntilBudgetReset } from "./rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("checkRate", () => {
  it("allows the default 8 per minute per IP on billed routes", () => {
    const t = 1_000_000;
    for (let i = 0; i < 8; i++) expect(checkRate("1.1.1.1", t + i).allowed).toBe(true);
    expect(checkRate("1.1.1.1", t + 8).allowed).toBe(false);
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

  it("reads the client IP from the LAST x-forwarded-for entry (the nearest proxy's)", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientIp(req)).toBe("10.0.0.1");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const xff = { "x-forwarded-for": "6.6.6.6, 3.3.3.3" };
    const realIp = { ...xff, "x-real-ip": "2.2.2.2" };
    const all = { ...realIp, "x-vercel-forwarded-for": "1.1.1.1" };
    expect(clientIp(new Request("http://x", { headers: all }))).toBe("1.1.1.1");
    expect(clientIp(new Request("http://x", { headers: realIp }))).toBe("2.2.2.2");
    expect(clientIp(new Request("http://x", { headers: xff }))).toBe("3.3.3.3");
  });

  it("a spoofed first x-forwarded-for entry does not give a fresh rate-limit bucket", () => {
    vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "1");
    const t = 7_000_000;
    const spoofed = (fake: string) => new Request("http://x", { headers: { "x-forwarded-for": `${fake}, 10.0.0.9` } });
    expect(checkRate(clientIp(spoofed("1.2.3.4")), t).allowed).toBe(true);
    expect(checkRate(clientIp(spoofed("5.6.7.8")), t + 1).allowed).toBe(false);
  });

  it("secondsUntilBudgetReset counts to the next UTC midnight", () => {
    expect(secondsUntilBudgetReset(Date.UTC(2026, 9, 28, 23, 59, 0))).toBe(60);
    expect(secondsUntilBudgetReset(Date.UTC(2026, 9, 28, 0, 0, 0))).toBe(86_400);
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
