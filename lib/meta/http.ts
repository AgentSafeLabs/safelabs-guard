// Shared plumbing for the live Meta clients (Spark, SAM, Voice).
// Server-side only: keys come from non-public env vars and are never logged
// or put into error messages. Clients never decide ALLOW/BLOCK.

export const META_BASE_URL = "https://api.meta.ai/v1";
export const META_TIMEOUT_MS = 10_000;

/**
 * "live": the API answered. "mock": a mock client produced the data on purpose.
 * "unavailable": a live call failed; the result carries no data, only `error`.
 */
export type MetaSource = "live" | "mock" | "unavailable";

/** Live only when SAFELABS_USE_MOCKS=false AND the client's key is set. */
export function shouldUseLive(apiKey: string | undefined): apiKey is string {
  return Boolean(apiKey) && process.env.SAFELABS_USE_MOCKS === "false";
}

export class MetaApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Fetch against api.meta.ai with Bearer auth and a 10s timeout. Throws on non-2xx. */
export async function metaFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  const res = await fetch(`${META_BASE_URL}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(META_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new MetaApiError(`HTTP ${res.status} from ${path}`, res.status);
  }
  return res;
}

/**
 * Loads a frame/audio reference (data URI or http(s) URL) as a Blob.
 * mock:// and other schemes are rejected, so the live call fails (unavailable).
 */
export async function loadBinary(ref: string): Promise<Blob> {
  const dataUri = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(ref);
  if (dataUri) {
    const [, type = "application/octet-stream", base64, payload] = dataUri;
    if (!base64) return new Blob([decodeURIComponent(payload)], { type });
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  if (/^https?:\/\//.test(ref)) {
    const res = await fetch(ref, { signal: AbortSignal.timeout(META_TIMEOUT_MS) });
    if (!res.ok) throw new MetaApiError(`HTTP ${res.status} loading media`, res.status);
    return res.blob();
  }
  throw new MetaApiError(`Unsupported media reference scheme: ${ref.split(":")[0]}`);
}

/** Error text that is safe to surface: never contains headers or keys. */
export function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return err.message;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return `Timed out after ${META_TIMEOUT_MS}ms`;
    }
    return err.message;
  }
  return "Unknown error";
}
