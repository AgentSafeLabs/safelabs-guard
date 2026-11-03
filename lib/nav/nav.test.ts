// Shared navigation: links, external-link attributes, current page, mobile
// menu, skip link. Rendered to static HTML on the server; no browser.

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import RootLayout, { metadata as layoutMetadata } from "../../app/layout";
import { NavMenuView } from "../../components/nav/NavMenu";
import SiteNav from "../../components/SiteNav";
import { html, tags, text } from "../site/test-utils";
import { BLOG_URL, REPO_URL } from "./links";

const nav = (pathname: string | null) => html(createElement(NavMenuView, { pathname }));
const desktop = (markup: string) => /<ul[^>]*data-nav="desktop"[^>]*>(.*?)<\/ul>/s.exec(markup)?.[1] ?? "";

describe("nav links", () => {
  const list = desktop(nav("/"));
  const anchors = tags(list, "a");

  it("renders Home, Live agent, Scenarios, Blog and GitHub with the right hrefs", () => {
    expect(anchors.map((a) => a.href)).toEqual(["/", "/live", "/scenarios", BLOG_URL, REPO_URL]);
    expect(text(list)).toMatch(/Home\s+Live agent\s+Scenarios\s+Blog\s+GitHub/);
    expect(BLOG_URL).toBe("https://agentsafelabs.com/blog/");
  });

  it("opens Blog and GitHub in a new tab with noopener noreferrer", () => {
    for (const a of anchors.filter((x) => x.href === BLOG_URL || x.href === REPO_URL)) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
      expect(a.rel).toContain("noreferrer");
    }
    for (const a of anchors.filter((x) => x.href.startsWith("/"))) expect(a.target).toBeUndefined();
  });

  it("marks only the current page with aria-current", () => {
    for (const [path, label] of [["/", "Home"], ["/live", "Live agent"], ["/scenarios", "Scenarios"]] as const) {
      const current = tags(desktop(nav(path)), "a").filter((a) => a["aria-current"] === "page");
      expect(current, path).toHaveLength(1);
      expect(current[0].href).toBe(path);
      expect(text(desktop(nav(path)))).toContain(label);
    }
    expect(tags(desktop(nav("/elsewhere")), "a").filter((a) => a["aria-current"])).toHaveLength(0);
  });

  it("gives the current link the chip background and bold text", () => {
    const current = tags(desktop(nav("/live")), "a").find((a) => a["aria-current"] === "page")!;
    expect(current.class).toContain("bg-chip");
    expect(current.class).toContain("font-bold");
  });

  it("gives every link at least a 44px target", () => {
    for (const a of anchors) expect(a.class).toContain("min-h-11");
  });
});

describe("mobile menu", () => {
  const markup = nav("/");
  const button = tags(markup, "button")[0];

  it("starts closed, with a labelled 44px button wired to the panel", () => {
    expect(button["aria-label"]).toBe("Open menu");
    expect(button["aria-expanded"]).toBe("false");
    expect(button["aria-controls"]).toBe("mobile-nav-panel");
    expect(button.class).toContain("h-11");
    expect(button.class).toContain("w-11");
  });

  it("renders the panel (hidden) with the same links on 48px rows", () => {
    const panel = tags(markup, "ul").find((u) => u.id === "mobile-nav-panel")!;
    expect(panel).toBeDefined();
    expect(panel.hidden).toBeDefined();
    const links = /<ul[^>]*id="mobile-nav-panel"[^>]*>(.*?)<\/ul>/s.exec(markup)![1];
    const anchors = tags(links, "a");
    expect(anchors.map((a) => a.href)).toEqual(["/", "/live", "/scenarios", BLOG_URL, REPO_URL]);
    for (const a of anchors) expect(a.class).toContain("min-h-12");
  });
});

describe("site nav and layout", () => {
  it("is a labelled Main landmark with the logo linking home", () => {
    const markup = html(createElement(SiteNav));
    expect(markup).toContain('<nav aria-label="Main"');
    const home = tags(markup, "a")[0];
    expect(home.href).toBe("/");
  });

  it("draws the logo as the wordmark image with a 2x source", () => {
    const markup = html(createElement(SiteNav));
    const img = tags(markup, "img")[0];
    expect(img.alt).toBe("SafeLabs Guard");
    expect(img.src).toBe("/brand/wordmark.png");
    expect(img.srcSet).toContain("/brand/wordmark@2x.png 1800w");
    expect(img.class).toMatch(/\bh-10\b/);
    expect(img.class).toContain("sm:h-[52px]");
  });

  it("puts a skip link before the nav in the root layout", () => {
    const page = html(createElement(RootLayout, null, createElement("main", { id: "content" }, "x")));
    const firstLink = tags(page, "a")[0];
    expect(firstLink.href).toBe("#content");
    expect(page.indexOf("Skip to content")).toBeLessThan(page.indexOf("<nav"));
    expect(page).toContain('<main id="content">x</main>');
  });

  it("has a default title and description", () => {
    expect(String(layoutMetadata.title)).toBe("SafeLabs Guard");
    expect(String(layoutMetadata.description)).not.toBe("");
  });
});
