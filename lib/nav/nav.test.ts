// Navigation restructure: the landing page leads to the live agent, the
// scenario demo is labelled as mock, and no page carries a banned claim.
// Pages are rendered to static HTML on the server; no browser, no network.

import type { Metadata } from "next";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout, { metadata as layoutMetadata } from "../../app/layout";
import Home, { metadata as homeMetadata } from "../../app/page";
import PackProofPage, { metadata as packproofMetadata } from "../../app/packproof/page";
import Scenarios, { metadata as scenariosMetadata } from "../../app/scenarios/page";
import SiteNav from "../../components/SiteNav";
import { REPO_URL } from "./links";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const decode = (s: string) => s.replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
/** Visible text, with each tag becoming a space (keeps neighbouring blocks apart). */
const text = (markup: string) => decode(markup.replace(/<[^>]*>/g, " "));
/** Visible text with tags removed outright (keeps inline markup from splitting a sentence). */
const flat = (markup: string) => decode(markup.replace(/<[^>]*>/g, ""));

const PAGES: [name: string, render: () => string][] = [
  ["/", () => html(createElement(Home))],
  ["/scenarios", () => html(createElement(Scenarios))],
  ["/packproof", () => html(createElement(PackProofPage))],
];

// Keep in sync with BANNED in lib/claims.test.ts, which cannot be imported
// (importing a test file would run its suite).
const COUNTED_RESULT = /\d+\/\d+\*{0,2} \(100%\)/g;
// The benchmark bar prints replay results read from benchmark-results.json
// (for example "Normal ALLOW: 100%"). They are labelled outputs, not claims,
// and the claims test exempts counted results the same way. Everything else
// on the page is still scanned for "100%".
const BENCHMARK_OUTPUT = /ASI-MM Benchmark.*?(?=Built by)/;
const BANNED: readonly [name: string, pattern: RegExp][] = [
  ["can make the unguarded agent ship", /can make the unguarded agent ship/i],
  ["ship early", /ship(s|ped|ping)? early/i],
  ["guaranteed", /guarantee/i],
  ["100%", /100 ?%/],
];

describe("landing page /", () => {
  const page = html(createElement(Home));

  it("links to the live agent and to the scenarios", () => {
    expect(page).toContain('href="/packproof"');
    expect(page).toContain('href="/scenarios"');
    expect(text(page)).toContain("Try the live PackProof agent");
    expect(text(page)).toContain("Deterministic scenarios (mock perception)");
  });

  it("states the status honestly and links the repo", () => {
    expect(text(page)).toContain(
      "Live Meta SAM, Spark and Voice on /packproof; scenarios use recorded or mock perception.",
    );
    expect(page).toContain(`href="${REPO_URL}"`);
  });

  it("does not render the scenario demo", () => {
    expect(text(page)).not.toMatch(/Live verification|Guarded|Unguarded/);
  });
});

describe("/scenarios", () => {
  const page = html(createElement(Scenarios));

  it("shows the mock-perception banner pointing at the live agent", () => {
    const banner = /<div role="note"[^>]*>(.*?)<\/div>/s.exec(page)?.[1] ?? "";
    expect(flat(banner)).toContain(
      "Mock perception: deterministic replay of the guard's decisions. For the live agent, go to /packproof.",
    );
    expect(banner).toContain('href="/packproof"');
    expect(banner).toMatch(/mock/i);
  });

  it("keeps the scenario demo components", () => {
    expect(text(page)).toContain("SAM 3.1 (mock)");
  });
});

describe("shared nav", () => {
  const nav = html(createElement(SiteNav));

  it("has Live agent, Scenarios and GitHub links in a labelled landmark", () => {
    expect(nav).toContain('aria-label="Primary"');
    expect(nav).toMatch(/href="\/packproof"[^>]*>Live agent</);
    expect(nav).toMatch(/href="\/scenarios"[^>]*>Scenarios</);
    expect(nav).toMatch(new RegExp(`href="${REPO_URL}"[^>]*>GitHub<`));
  });

  it("is rendered by the root layout, which wraps every page", () => {
    const page = html(createElement(RootLayout, null, createElement("main", null, "x")));
    expect(page).toContain('aria-label="Primary"');
    expect(page).toContain("<main>x</main>");
  });
});

describe("metadata", () => {
  it("gives each page its own title", () => {
    const titles = [homeMetadata, scenariosMetadata, packproofMetadata].map((m) => String(m.title));
    expect(new Set(titles).size).toBe(3);
    expect(String(scenariosMetadata.title)).toMatch(/mock/i);
  });

  it("carries no banned claim", () => {
    const all: Metadata[] = [layoutMetadata, homeMetadata, scenariosMetadata, packproofMetadata];
    for (const m of all) {
      const copy = `${String(m.title)} ${String(m.description ?? "")}`;
      for (const [name, pattern] of BANNED) expect(copy, name).not.toMatch(pattern);
    }
  });
});

describe("banned claim phrases", () => {
  for (const [route, render] of PAGES) {
    for (const [name, pattern] of BANNED) {
      it(`${route} does not contain "${name}"`, () => {
        const copy = text(render()).replace(COUNTED_RESULT, "").replace(BENCHMARK_OUTPUT, "");
        expect(copy).not.toMatch(pattern);
      });
    }
  }
});
