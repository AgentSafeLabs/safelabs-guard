// The favicon and share images exist with the expected pixel sizes. Reads the
// PNG / ICO headers directly; no image library.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "../../app/layout";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p));

function pngSize(p: string): [number, number] {
  const b = read(p);
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function icoSizes(p: string): number[] {
  const b = read(p);
  expect(b.readUInt16LE(0)).toBe(0);
  expect(b.readUInt16LE(2)).toBe(1);
  return Array.from({ length: b.readUInt16LE(4) }, (_, i) => b[6 + i * 16] || 256).sort((a, c) => a - c);
}

describe("brand assets", () => {
  it.each([
    ["app/icon.png", [512, 512]],
    ["app/apple-icon.png", [180, 180]],
    ["app/opengraph-image.png", [1200, 630]],
    ["app/twitter-image.png", [1200, 630]],
    ["public/brand/icon.png", [512, 512]],
    ["public/brand/wordmark.png", [900]],
    ["public/brand/wordmark@2x.png", [1800]],
    ["public/brand/stacked.png", [640]],
    ["public/brand/stacked@2x.png", [1100]],
  ] as [string, number[]][])("%s has the expected size", (path, size) => {
    expect(existsSync(resolve(ROOT, path))).toBe(true);
    const [w, h] = pngSize(path);
    expect(w).toBe(size[0]);
    if (size[1]) expect(h).toBe(size[1]);
  });

  it("has a favicon.ico with 16, 32 and 48 px images", () => {
    expect(icoSizes("app/favicon.ico")).toEqual([16, 32, 48]);
  });

  it("has the demo poster at 1280x720 and 640x360", () => {
    for (const [p, w, h] of [["public/brand/demo-poster.jpg", 1280, 720], ["public/brand/demo-poster-640.jpg", 640, 360]] as const) {
      const b = read(p);
      expect(b.subarray(0, 2).toString("hex")).toBe("ffd8");
      let i = 2;
      while (i < b.length) {
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xc3) {
          expect([b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]).toEqual([w, h]);
          return;
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
      throw new Error(`no frame header in ${p}`);
    }
  });

  it("sets metadataBase and share text; the image files supply og:image and twitter:image", () => {
    expect(metadata.metadataBase).toBeDefined();
    expect(metadata.openGraph?.title).toBe("Safelabs Guard");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
