// Helpers for tests that render pages to static HTML. Test-only.

import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export const html = (el: ReactElement): string => renderToStaticMarkup(el);
export const render = (component: ComponentType, props?: object): string => html(createElement(component, props ?? null));

const decode = (s: string) =>
  s
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");

/** Visible text, with each tag becoming a space (keeps neighbouring blocks apart). */
export const text = (markup: string): string => decode(markup.replace(/<[^>]*>/g, " ")).replace(/ +/g, " ");
/** Visible text with tags removed outright (keeps inline markup from splitting a sentence). */
export const flat = (markup: string): string => decode(markup.replace(/<[^>]*>/g, ""));

/** Attributes of every opening tag named `tag`, in document order. */
export function tags(markup: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))) {
    const attrs: Record<string, string> = {};
    for (const a of (m[1] ?? "").matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    out.push(attrs);
  }
  return out;
}

// Keep in sync with BANNED in lib/claims.test.ts, which cannot be imported
// (importing a test file would run its suite).
export const COUNTED_RESULT = /\d+\/\d+\*{0,2} \(100%\)/g;
// The benchmark bar prints replay results read from benchmark-results.json
// (for example "Normal ALLOW: 100%"). They are labelled outputs, not claims,
// and the claims test exempts counted results the same way.
export const BENCHMARK_OUTPUT = /ASI-MM Benchmark.*?(?=Built by)/;
export const BANNED: readonly [name: string, pattern: RegExp][] = [
  ["can make the unguarded agent ship", /can make the unguarded agent ship/i],
  ["ship early", /ship(s|ped|ping)? early/i],
  ["guaranteed", /guarantee/i],
  ["100%", /100 ?%/],
];
// Absolute claims the redesign copy must avoid, beyond the existing list.
export const ALSO_BANNED: readonly [name: string, pattern: RegExp][] = [
  ["unbeatable", /unbeatable/i],
  ["certified", /certified/i],
  ["prevents all", /prevents? all/i],
];
