import { describe, expect, it } from "vitest";
import { assertSafeRuntime, describeRuntime, isProduction } from "./runtime-mode";

const KEYS = { META_SPARK_API_KEY: "k1", META_SAM_API_KEY: "k2", META_VOICE_API_KEY: "k3" };

describe("isProduction", () => {
  it("is true for NODE_ENV=production or VERCEL_ENV=production", () => {
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});

describe("assertSafeRuntime", () => {
  it("allows anything outside production", () => {
    expect(assertSafeRuntime({ NODE_ENV: "development", SAFELABS_USE_MOCKS: "true" })).toBeNull();
    expect(assertSafeRuntime({ NODE_ENV: "test" })).toBeNull();
  });

  it("refuses production unless SAFELABS_USE_MOCKS is exactly \"false\"", () => {
    for (const value of [undefined, "", "true", "FALSE", "0", "no", " false"]) {
      const refusal = assertSafeRuntime({ NODE_ENV: "production", SAFELABS_USE_MOCKS: value });
      expect(refusal?.status).toBe(503);
      expect(refusal?.error).toBe("Agent is not configured for production");
    }
    expect(assertSafeRuntime({ VERCEL_ENV: "production", SAFELABS_USE_MOCKS: "true" })?.status).toBe(503);
  });

  it("serves production with live mode", () => {
    expect(assertSafeRuntime({ NODE_ENV: "production", SAFELABS_USE_MOCKS: "false", ...KEYS })).toBeNull();
  });

  it("refuses production when the kill switch is on, even with live settings", () => {
    const refusal = assertSafeRuntime({ NODE_ENV: "production", SAFELABS_USE_MOCKS: "false", SAFELABS_LIVE_DISABLED: "true" });
    expect(refusal?.error).toBe("Agent is disabled");
  });

  it("honours only an exact SAFELABS_ALLOW_MOCK_IN_PRODUCTION=true", () => {
    expect(assertSafeRuntime({ NODE_ENV: "production", SAFELABS_ALLOW_MOCK_IN_PRODUCTION: "true" })).toBeNull();
    expect(
      assertSafeRuntime({ NODE_ENV: "production", SAFELABS_LIVE_DISABLED: "true", SAFELABS_ALLOW_MOCK_IN_PRODUCTION: "true" }),
    ).toBeNull();
    for (const value of ["1", "yes", "TRUE", ""]) {
      expect(assertSafeRuntime({ NODE_ENV: "production", SAFELABS_ALLOW_MOCK_IN_PRODUCTION: value })?.status).toBe(503);
    }
  });

  it("never echoes env values", () => {
    const refusal = assertSafeRuntime({ NODE_ENV: "production", SAFELABS_USE_MOCKS: "secret-ish-value" });
    expect(JSON.stringify(refusal)).not.toContain("secret-ish-value");
  });
});

describe("describeRuntime", () => {
  it("reports live only with mocks off, no kill switch and all keys", () => {
    expect(describeRuntime({ SAFELABS_USE_MOCKS: "false", ...KEYS }).mode).toBe("live");
  });

  it("reports mock with a reason in every other case", () => {
    expect(describeRuntime({ SAFELABS_USE_MOCKS: "true", ...KEYS })).toEqual({
      mode: "mock",
      reason: "Mock mode on (SAFELABS_USE_MOCKS=true).",
    });
    expect(describeRuntime({}).mode).toBe("mock");
    expect(describeRuntime({ SAFELABS_USE_MOCKS: "false", SAFELABS_LIVE_DISABLED: "true", ...KEYS }).reason).toMatch(/Kill switch/);
    const missing = describeRuntime({ SAFELABS_USE_MOCKS: "false", META_SAM_API_KEY: "k" });
    expect(missing.mode).toBe("mock");
    expect(missing.reason).toContain("META_SPARK_API_KEY, META_VOICE_API_KEY");
    expect(missing.reason).not.toContain("k2");
  });
});
