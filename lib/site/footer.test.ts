// Shared site footer: present on all three routes, link targets, external
// attributes, the FAQ anchor it points at, layout rules and claims.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Home from "../../app/page";
import Live from "../../app/live/page";
import Scenarios from "../../app/scenarios/page";
import SiteFooter from "../../components/SiteFooter";
import { BLOG_URL, REPO_URL } from "../nav/links";
import { ALSO_BANNED, BANNED, COUNTED_RESULT, render, tags, text } from "./test-utils";

const ROUTES: [route: string, markup: string][] = [
  ["/", render(Home)],
  ["/live", render(Live)],
  ["/scenarios", render(Scenarios)],
];

const footerOf = (markup: string) => /<footer\b[^>]*aria-label="Site footer"[^>]*>.*<\/footer>/s.exec(markup)?.[0] ?? "";
const FOOTER = render(SiteFooter);

describe("site footer on every route", () => {
  for (const [route, markup] of ROUTES) {
    it(`${route} renders exactly one footer, identical to the component`, () => {
      expect(markup.match(/<footer\b/g)).toHaveLength(1);
      expect(footerOf(markup)).toBe(FOOTER);
    });
  }

  it("is a server component with no client directive or hex colours", () => {
    const src = readFileSync(resolve(__dirname, "..", "..", "components", "SiteFooter.tsx"), "utf8");
    expect(src).not.toMatch(/["']use client["']/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/gradient/i);
  });
});

describe("footer content", () => {
  const copy = text(FOOTER);

  it("has the brand block, tagline and hackathon chip", () => {
    expect(copy).toContain("Safelabs Guard");
    expect(copy).toContain("Verify what the agent sees before it acts.");
    expect(copy).toContain("Built for the Meta Global AI Developer Hackathon");
    expect(FOOTER).toContain("M12 3l7 3v5"); // the nav's shield path
    expect(FOOTER).not.toMatch(/<img/);
  });

  it("has the bottom bar with the limits visible", () => {
    expect(copy).toContain("Built by Safe Labs AI Inc.");
    expect(copy).toContain("2026");
    expect(copy).toContain("Shipment is simulated. Hackathon demo.");
  });

  it("uses a surface-2 background, a border-token top border and 56px/32px padding", () => {
    const footer = tags(FOOTER, "footer")[0];
    expect(footer.class).toMatch(/\bborder-t\b/);
    expect(footer.class).toMatch(/\bborder-line\b/);
    expect(footer.class).toMatch(/\bbg-surface-2\b/);
    expect(FOOTER).toMatch(/max-w-6xl[^"]*\bpb-8\b[^"]*\bpt-14\b/);
  });

  it("has two labelled nav groups with non-link headings", () => {
    expect(tags(FOOTER, "nav").map((n) => n["aria-label"])).toEqual(["Product", "Resources"]);
    const headings = [...FOOTER.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map((m) => m[1]);
    expect(headings).toEqual(["Product", "Resources"]);
    expect(FOOTER).not.toMatch(/<h2[^>]*>\s*<a\b/);
  });

  it("lists the internal links without target or rel", () => {
    const anchors = tags(FOOTER, "a");
    const internal = anchors.filter((a) => a.href.startsWith("/"));
    expect(internal.map((a) => a.href)).toEqual(["/", "/live", "/scenarios", "/#faq"]);
    for (const a of internal) {
      expect(a.target).toBeUndefined();
      expect(a.rel).toBeUndefined();
    }
    expect(copy).toMatch(/Home.*Live agent.*Scenarios.*FAQ/);
  });

  it("opens Blog and GitHub in a new tab with an arrow icon and sr-only text", () => {
    const external = tags(FOOTER, "a").filter((a) => !a.href.startsWith("/"));
    expect(external.map((a) => a.href)).toEqual([BLOG_URL, REPO_URL]);
    for (const a of external) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
    }
    const resources = /<nav[^>]*aria-label="Resources"[^>]*>(.*?)<\/nav>/s.exec(FOOTER)![1];
    expect(resources.match(/<svg\b/g)).toHaveLength(2);
    expect(resources.match(/<span class="sr-only">\(opens in a new tab\)<\/span>/g)).toHaveLength(2);
    expect(copy).toContain("Blog");
    expect(copy).toContain("Source on GitHub");
  });

  it("gives every link a 44px row and the accent hover and focus style", () => {
    const anchors = tags(FOOTER, "a");
    expect(anchors).toHaveLength(6);
    for (const a of anchors) {
      expect(a.class).toMatch(/\bmin-h-11\b/);
      expect(a.class).toMatch(/\btext-soft\b/);
      expect(a.class).toMatch(/hover:text-accent/);
      expect(a.class).toMatch(/focus-visible:text-accent/);
      expect(a.class).toMatch(/hover:underline-offset-4/);
      expect(a.class).not.toMatch(/(^|\s)underline(\s|$)/); // no underline by default
    }
  });

  it("stacks on mobile: single column, two-column link grid, wrapping chip", () => {
    expect(FOOTER).toMatch(/grid grid-cols-2/);
    expect(FOOTER).not.toMatch(/whitespace-nowrap|overflow-x/);
  });
});

describe("footer anchor", () => {
  it("/ has one element with id=faq, and the footer links to it", () => {
    const home = ROUTES[0][1];
    expect(home.match(/\sid="faq"/g)).toHaveLength(1);
    expect(tags(home, "section").some((s) => s.id === "faq")).toBe(true);
    expect(tags(FOOTER, "a").some((a) => a.href === "/#faq")).toBe(true);
  });
});

describe("claims in the footer", () => {
  const copy = text(FOOTER).replace(COUNTED_RESULT, "");
  for (const [name, pattern] of [...BANNED, ...ALSO_BANNED]) {
    it(`does not contain "${name}"`, () => {
      expect(copy).not.toMatch(pattern);
    });
  }

  it("shows no Meta logo and does not imply Meta endorsement", () => {
    expect(FOOTER).not.toMatch(/<img|<picture|meta-logo|endorse|partner|official|sponsor/i);
    expect(copy).not.toMatch(/endorse|partner|official|sponsor|powered by meta|approved by meta/i);
  });
});
