import { describe, expect, it } from "vitest";
import { computeTargetSize, encodeUnderLimit, ImageTooLargeError } from "./image";

describe("computeTargetSize", () => {
  it("scales landscape by the width", () => {
    expect(computeTargetSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it("scales portrait by the height", () => {
    expect(computeTargetSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it("leaves small frames alone (no upscaling)", () => {
    expect(computeTargetSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("keeps a frame exactly at the edge", () => {
    expect(computeTargetSize(1280, 960)).toEqual({ width: 1280, height: 960 });
    expect(computeTargetSize(1281, 1281)).toEqual({ width: 1280, height: 1280 });
  });

  it("honours a custom max edge and rejects empty frames", () => {
    expect(computeTargetSize(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(() => computeTargetSize(0, 720)).toThrow();
  });
});

describe("encodeUnderLimit", () => {
  const blobOf = (n: number) => new Blob([new Uint8Array(n)]);

  it("lowers quality stepwise until the blob fits", async () => {
    const tried: number[] = [];
    const blob = await encodeUnderLimit(async (q) => {
      tried.push(q);
      return blobOf(q > 0.65 ? 200 : 50);
    }, 100);
    expect(blob.size).toBe(50);
    expect(tried).toEqual([0.9, 0.8, 0.7, 0.6]);
  });

  it("fails clearly when nothing fits", async () => {
    await expect(encodeUnderLimit(async () => blobOf(200), 100)).rejects.toBeInstanceOf(ImageTooLargeError);
    await expect(encodeUnderLimit(async () => null, 100)).rejects.toThrow(/over 8 MB/);
  });
});
