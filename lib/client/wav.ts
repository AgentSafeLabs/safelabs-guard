// Pure audio helpers for the browser mic: merge captured chunks, downsample to
// 16 kHz, and encode mono 16-bit PCM WAV (the format lib/meta/voice.ts sends).
// No DOM, so everything here is unit-testable.

export const TARGET_SAMPLE_RATE = 16_000;
export const MAX_DURATION_SECONDS = 15;

export class AudioTooLongError extends Error {
  constructor(seconds: number) {
    super(`Recording is ${seconds.toFixed(1)} s; the limit is ${MAX_DURATION_SECONDS} s.`);
    this.name = "AudioTooLongError";
  }
}

export function mergeChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Box-average downsampling. Only lowers the rate; equal rates return a copy. */
export function downsample(samples: Float32Array, fromRate: number, toRate: number = TARGET_SAMPLE_RATE): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new Error("Sample rates must be positive");
  if (toRate > fromRate) throw new Error(`Cannot upsample from ${fromRate} Hz to ${toRate} Hz`);
  if (toRate === fromRate) return samples.slice();
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Mono 16-bit PCM WAV. Samples are clipped to [-1, 1]. Throws past 15 s. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error("sampleRate must be a positive integer");
  const seconds = samples.length / sampleRate;
  if (seconds > MAX_DURATION_SECONDS) throw new AudioTooLongError(seconds);

  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return new Uint8Array(buffer);
}
