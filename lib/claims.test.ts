// Guards the public copy against claims we have not measured. Reads the page
// components, the home page and the README as text; no network, no rendering.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const FILES = [
  join(ROOT, "README.md"),
  join(ROOT, "app", "page.tsx"),
  join(ROOT, "app", "packproof", "page.tsx"),
  ...listFiles(join(ROOT, "components")).filter((f) => f.endsWith(".tsx")),
];

/** File text with whitespace collapsed, so a phrase wrapped across JSX lines still matches. */
function normalised(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ");
}

// Counted replay results such as "5/5 (100%)" are outputs, not claims.
const COUNTED_RESULT = /\d+\/\d+\*{0,2} \(100%\)/g;

const BANNED: readonly [name: string, pattern: RegExp][] = [
  ["can make the unguarded agent ship", /can make the unguarded agent ship/i],
  ["ship early", /ship(s|ped|ping)? early/i],
  ["guaranteed", /guarantee/i],
  ["100%", /100 ?%/],
];

describe("public copy claims", () => {
  it("scans the files it is meant to scan", () => {
    const names = FILES.map((f) => f.slice(ROOT.length + 1));
    expect(names).toContain("README.md");
    expect(names).toContain("app/page.tsx");
    expect(names).toContain("app/packproof/page.tsx");
    expect(names.some((n) => n.startsWith("components/"))).toBe(true);
  });

  for (const [name, pattern] of BANNED) {
    it(`does not contain "${name}"`, () => {
      const hits = FILES.filter((f) => pattern.test(normalised(f).replace(COUNTED_RESULT, "")));
      expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    });
  }
});
