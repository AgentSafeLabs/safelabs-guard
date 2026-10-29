// Route map and leftovers: the three pages exist, the old /packproof page is
// gone, and no tracked source, test, README or doc still points at it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const OLD = "packproof"; // the removed route segment, spelled out only here

describe("route map", () => {
  it("has the home, live and scenarios pages", () => {
    for (const p of ["app/page.tsx", "app/live/page.tsx", "app/scenarios/page.tsx"]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
  });

  it(`has no app/${OLD} page`, () => {
    // `patch -E` deletes the file but leaves the emptied directory behind;
    // an empty directory is not a route.
    const dir = join(ROOT, "app", OLD);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("keeps the API routes at their paths", () => {
    for (const p of ["app/api/agent/turn/route.ts", `app/api/${OLD}/ship/route.ts`, "app/api/guard/live-check/route.ts", "app/api/meta/status/route.ts"]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
  });
});

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "audit"]);
const EXTENSIONS = /\.(ts|tsx|mjs|md|json|css|sh|example)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name) || name === "package-lock.json") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : EXTENSIONS.test(name) ? [path] : [];
  });
}

// "/packproof" as a page URL: after whitespace, a quote, a bracket or a
// backtick; on a host; or as the old page file. "/api/packproof/ship" (an API
// route that keeps its path) and imports such as "../agent/packproof" are not.
const PAGE_REFERENCE: readonly RegExp[] = [
  new RegExp("(?:^|[\\s\"'`(<\\[])/" + OLD + "(?![\\w-])", "m"),
  new RegExp("\\.[a-z]{2,}/" + OLD + "(?![\\w-])"),
  new RegExp("app/" + OLD + "(?![\\w-])"),
];

describe(`no page reference to /${OLD}`, () => {
  it("scans the files it is meant to scan", () => {
    const names = files(ROOT).map((f) => relative(ROOT, f));
    expect(names).toContain("README.md");
    expect(names).toContain("docs/ARCHITECTURE.md");
    expect(names).toContain("app/live/page.tsx");
    expect(names.some((n) => n.startsWith("docs/audit/"))).toBe(false);
  });

  it("finds none in source, tests, README or docs (docs/audit excluded)", () => {
    const hits = files(ROOT)
      .filter((f) => f !== __filename) // this file describes the pattern it searches for
      .filter((f) => PAGE_REFERENCE.some((re) => re.test(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
