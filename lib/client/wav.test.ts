import { describe, expect, it } from "vitest";
import { AudioTooLongError, downsample, encodeWav, mergeChunks } from "./wav";

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(start, start + len)));
}

describe("encodeWav", () => {
  it("writes a mono 16-bit PCM RIFF/WAVE header", () => {
    const wav = encodeWav(new Float32Array(100), 16_000);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 200);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(200);
  });

  it("writes one 16-bit sample per input sample", () => {
    expect(encodeWav(new Float32Array(1234), 16_000).length).toBe(44 + 1234 * 2);
    expect(encodeWav(new Float32Array(0), 16_000).length).toBe(44);
  });

  it("clips at +/-1 and maps the extremes to the int16 range", () => {
    const wav = encodeWav(new Float32Array([2, 1, 0, -1, -5, NaN, 0.5]), 16_000);
    const view = new DataView(wav.buffer);
    const s = (i: number) => view.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5)]).toEqual([32767, 32767, 0, -32768, -32768, 0]);
    expect(s(6)).toBe(Math.round(0.5 * 0x7fff));
  });

  it("enforces the 15 s limit", () => {
    expect(() => encodeWav(new Float32Array(16_000 * 15), 16_000)).not.toThrow();
    expect(() => encodeWav(new Float32Array(16_000 * 15 + 1), 16_000)).toThrow(AudioTooLongError);
    expect(() => encodeWav(new Float32Array(16_000 * 15 + 1), 16_000)).toThrow(/limit is 15 s/);
  });

  it("rejects a bad sample rate", () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow();
    expect(() => encodeWav(new Float32Array(1), 44_100.5)).toThrow();
  });
});

describe("downsample", () => {
  it("produces the expected length", () => {
    expect(downsample(new Float32Array(48_000), 48_000, 16_000).length).toBe(16_000);
    expect(downsample(new Float32Array(44_100), 44_100, 16_000).length).toBe(16_000);
    expect(downsample(new Float32Array(10), 16_000, 16_000).length).toBe(10);
  });

  it("preserves a DC level", () => {
    const out = downsample(new Float32Array(4_800).fill(0.25), 48_000, 16_000);
    for (const v of Array.from(out)) expect(v).toBeCloseTo(0.25, 6);
  });

  it("averages each window", () => {
    expect(Array.from(downsample(new Float32Array([0, 0.3, 0.6, 1, 1, 1]), 3, 1))).toEqual([
      expect.closeTo(0.3, 6),
      1,
    ]);
  });

  it("refuses to upsample", () => {
    expect(() => downsample(new Float32Array(10), 8_000, 16_000)).toThrow(/upsample/);
  });
});

describe("mergeChunks", () => {
  it("concatenates in order", () => {
    const merged = mergeChunks([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])]);
    expect(Array.from(merged)).toEqual([1, 2, 3]);
    expect(mergeChunks([]).length).toBe(0);
  });
});
