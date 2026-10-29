import { describe, expect, it } from "vitest";
import { isCurrent, NAV_LINKS } from "./links";
import { nextMenuOpen } from "./menu";

describe("nextMenuOpen", () => {
  it("toggles open and closed", () => {
    expect(nextMenuOpen(false, "toggle")).toBe(true);
    expect(nextMenuOpen(true, "toggle")).toBe(false);
  });

  it("closes on Escape, a link click and a route change", () => {
    for (const event of ["escape", "link-click", "route-change"] as const) {
      expect(nextMenuOpen(true, event), event).toBe(false);
      expect(nextMenuOpen(false, event), event).toBe(false);
    }
  });
});

describe("isCurrent", () => {
  const by = (label: string) => NAV_LINKS.find((l) => l.label === label)!;

  it("matches the exact path only", () => {
    expect(isCurrent("/live", by("Live agent"))).toBe(true);
    expect(isCurrent("/", by("Home"))).toBe(true);
    expect(isCurrent("/live", by("Home"))).toBe(false);
    expect(isCurrent("/scenarios", by("Live agent"))).toBe(false);
  });

  it("is never true for external links or an unknown path", () => {
    expect(isCurrent("/", by("Blog"))).toBe(false);
    expect(isCurrent("/", by("GitHub"))).toBe(false);
    expect(isCurrent(null, by("Home"))).toBe(false);
  });
});
