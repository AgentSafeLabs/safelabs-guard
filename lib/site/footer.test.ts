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
import { YOUTUBE_ID, YOUTUBE_WATCH_URL } from "./demo-video";
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

  it("has the stacked logo, nothing under it, and the hackathon chip", () => {
    const img = tags(FOOTER, "img")[0];
    expect(img.alt).toBe("SafeLabs Guard");
    expect(img.src).toBe("/brand/stacked.png");
    expect(img.srcSet).toContain("/brand/stacked@2x.png 1100w");
    expect(copy).not.toContain("Verify what the agent sees before it acts.");
    const logoColumn = /<img[^>]*>(.*?)<\/div><div class="min-w-0/s.exec(FOOTER)?.[1] ?? "x";
    expect(text(logoColumn).trim()).toBe("");
    expect(copy).toContain("Built for the Meta Global AI Developer Hackathon");
  });

  it("has the copyright line", () => {
    expect(copy).toContain("© 2026 SafeLabs Guard · Built by Waqar Javed, Startup Founder of Safe Labs AI Inc.");
  });

  it("uses a surface-2 background, a border-token top border and a 1200px container", () => {
    const footer = tags(FOOTER, "footer")[0];
    expect(footer.class).toMatch(/\bborder-t\b/);
    expect(footer.class).toMatch(/\bborder-line\b/);
    expect(footer.class).toMatch(/\bbg-surface-2\b/);
    expect(FOOTER).toMatch(/max-w-\[1200px\]/);
    expect(FOOTER).toContain("lg:gap-[72px]");
  });

  it("has one link row: Home, Live agent, Scenarios, Demo video, Blog, GitHub", () => {
    const row = /<nav[^>]*aria-label="Footer"[^>]*>(.*?)<\/nav>/s.exec(FOOTER)![1];
    expect(text(row)).toMatch(/Home.*Live agent.*Scenarios.*Demo video.*Blog.*GitHub/);
    const anchors = tags(row, "a");
    expect(anchors.map((a) => a.href)).toEqual(["/", "/live", "/scenarios", YOUTUBE_WATCH_URL, BLOG_URL, REPO_URL]);
    for (const a of anchors.filter((x) => !x.href.startsWith("/"))) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
    }
    for (const a of anchors) expect(a.class).toMatch(/\bmin-h-11\b/);
  });

  it("builds the Demo video link from YOUTUBE_ID", () => {
    expect(YOUTUBE_WATCH_URL).toBe(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`);
    expect(tags(FOOTER, "a").some((a) => a.href === `https://www.youtube.com/watch?v=${YOUTUBE_ID}`)).toBe(true);
  });

  it("has the Built by card with exactly the six profile links", () => {
    expect(copy).toContain("Built by Waqar Javed");
    expect(copy).toContain("Startup Founder of Safe Labs AI Inc.");
    const profiles = /<ul[^>]*aria-label="Profiles"[^>]*>(.*?)<\/ul>/s.exec(FOOTER)![1];
    const anchors = tags(profiles, "a");
    expect(anchors.map((a) => a.href)).toEqual([
      "https://waqarjaved.com/",
      "https://www.linkedin.com/in/waqarjaved",
      "https://x.com/iamwaqarjaved",
      "https://www.youtube.com/@iamwaqarjaved",
      "https://scholar.google.com/citations?user=RlD1h5gAAAAJ",
      "https://github.com/iamwaqarjaved",
    ]);
    expect(anchors.map((a) => a["aria-label"])).toEqual(["Website, waqarjaved.com", "LinkedIn", "X", "YouTube", "Google Scholar", "GitHub profile"]);
    for (const a of anchors) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
      expect(a.class).toMatch(/\bh-11\b/);
      expect(a.class).toMatch(/\bw-11\b/);
      expect(a.class).toMatch(/focus-visible:/);
    }
    expect(profiles.match(/<svg\b/g)).toHaveLength(6);
    expect(FOOTER).not.toMatch(/facebook|instagram|tiktok/i);
  });

  it("stacks on mobile: wrapping link row and card, no horizontal scroll", () => {
    expect(FOOTER).toMatch(/flex flex-wrap/);
    expect(FOOTER).not.toMatch(/whitespace-nowrap|overflow-x/);
  });
});

describe("footer anchor", () => {
  it("/ keeps one element with id=faq", () => {
    const home = ROUTES[0][1];
    expect(home.match(/\sid="faq"/g)).toHaveLength(1);
    expect(tags(home, "section").some((s) => s.id === "faq")).toBe(true);
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
    expect(tags(FOOTER, "img").map((i) => i.src)).toEqual(["/brand/stacked.png"]);
    expect(FOOTER).not.toMatch(/<picture|meta-logo|endorse|partner|official|sponsor/i);
    expect(copy).not.toMatch(/endorse|partner|official|sponsor|powered by meta|approved by meta/i);
  });
});
