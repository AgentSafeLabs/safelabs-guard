import { describe, expect, it } from "vitest";
import { SHADOW_LABEL, type SecurityEvent } from "../agent/security-events";
import { failClosedExplanation, imageTextLabel, injectionBanner, sourceBadgeText } from "./labels";

const event = (source: SecurityEvent["source"], shadow = false): SecurityEvent => ({
  kind: "injection",
  source,
  excerpt: "x",
  shadow,
  ...(shadow ? { label: SHADOW_LABEL } : {}),
});

describe("sourceBadgeText", () => {
  it("shows VOICE: NOT SENT when no clip was sent, not 'unavailable'", () => {
    expect(sourceBadgeText("Voice", "unavailable", { notSent: true })).toBe("VOICE: NOT SENT");
    expect(sourceBadgeText("Voice", "mock", { notSent: true })).toBe("VOICE: NOT SENT");
  });

  it("shows the server's label otherwise", () => {
    expect(sourceBadgeText("Voice", "unavailable")).toBe("VOICE: UNAVAILABLE");
    expect(sourceBadgeText("Voice", "live")).toBe("VOICE: LIVE");
    expect(sourceBadgeText("SAM", "mock")).toBe("SAM: MOCK");
  });
});

describe("imageTextLabel", () => {
  it("reflects the real source status", () => {
    expect(imageTextLabel("live")).toBe("Image text (live)");
    expect(imageTextLabel("mock")).toBe("Image text (mock)");
    expect(imageTextLabel("unavailable")).toBe("Image text (unavailable)");
  });
});

describe("failClosedExplanation", () => {
  it("explains an image-text fail-closed BLOCK in plain language", () => {
    const text = "The guard blocked this because it could not read the image. This is the safe default.";
    expect(failClosedExplanation({ decision: "BLOCK", reason: "image text unavailable" })).toBe(text);
    expect(failClosedExplanation({ decision: "BLOCK", reason: "image text unavailable: ocr timeout" })).toBe(text);
  });

  it("is null for other decisions and ordinary blocks", () => {
    expect(failClosedExplanation(null)).toBeNull();
    expect(failClosedExplanation({ decision: "ALLOW", reason: "Verified VERIFY_MUG" })).toBeNull();
    expect(failClosedExplanation({ decision: "BLOCK", reason: "Perception mismatch: unexpected laptop" })).toBeNull();
  });
});

describe("injectionBanner", () => {
  it("names where the injection was found", () => {
    expect(injectionBanner([event("image")])).toBe("Guard detected an injection attempt in image text");
    expect(injectionBanner([event("voice")])).toBe("Guard detected an injection attempt in voice");
    expect(injectionBanner([event("image"), event("voice")])).toBe("Guard detected an injection attempt in image text and voice");
    expect(injectionBanner([event("both")])).toBe("Guard detected an injection attempt in image text and voice");
  });

  it("labels shadow events and is null with no events", () => {
    expect(injectionBanner([event("image", true)])).toBe(
      "Guard detected an injection attempt in image text (shadow: the guard would have flagged this)",
    );
    expect(injectionBanner([])).toBeNull();
    expect(injectionBanner(undefined)).toBeNull();
  });
});
