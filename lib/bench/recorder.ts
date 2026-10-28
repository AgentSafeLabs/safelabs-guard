// Record/replay for every external call the benchmark makes (SAM per
// concept, Voice, Spark reasoning). SAFELABS_BENCH_MODE picks the mode:
//   replay  read bench/recordings only; a missing recording is a hard error,
//           never a live fallback (the default)
//   record  reuse a recording when it exists, otherwise call live and save it
//   live    call live, save nothing
// Key: sha256 of canonical JSON {service, model, promptHash, params,
// inputSha256}. A recording holds ONLY {model, recordedAt, response}, where
// response is the parsed result; never headers, keys, URLs or raw bodies.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scanRecordingText } from "./secrets";

export const BENCH_MODES = ["replay", "record", "live"] as const;
export type BenchMode = (typeof BENCH_MODES)[number];

export type BenchService = "sam" | "voice" | "spark-reasoning";

export interface KeyInput {
  service: BenchService;
  model: string;
  /** sha256 of the prompt text (SAM concept, or the exact reasoning messages); null when there is none. */
  promptHash: string | null;
  params: Record<string, unknown>;
  /** sha256 of the media file sent; null when there is none. */
  inputSha256: string | null;
}

export interface StoredRecording<T> {
  model: string;
  recordedAt: string;
  response: T;
}

/** Reads SAFELABS_BENCH_MODE; unset means replay. Anything else throws. */
export function benchMode(env: Record<string, string | undefined> = process.env): BenchMode {
  const raw = env.SAFELABS_BENCH_MODE?.trim() || "replay";
  if (!(BENCH_MODES as readonly string[]).includes(raw)) {
    throw new Error(`SAFELABS_BENCH_MODE must be one of ${BENCH_MODES.join(", ")}`);
  }
  return raw as BenchMode;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with object keys sorted at every level; undefined fields dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function recordingKey(input: KeyInput): string {
  return sha256Hex(
    canonicalJson({
      service: input.service,
      model: input.model,
      promptHash: input.promptHash,
      params: input.params,
      inputSha256: input.inputSha256,
    }),
  );
}

export class ReplayMissError extends Error {
  constructor(readonly service: BenchService, readonly key: string) {
    super(`No recording for ${service} ${key}. Replay never calls live: run bench:record first.`);
    this.name = "ReplayMissError";
  }
}

export interface RecorderOptions {
  mode: BenchMode;
  /** bench/recordings */
  dir: string;
  now?: () => Date;
}

export class Recorder {
  readonly mode: BenchMode;
  readonly dir: string;
  private readonly now: () => Date;
  /** Live calls made through call() (one per recording made or live result used). */
  liveCalls = 0;
  /** First hard error (replay miss, failed live call). Callers that swallow errors check it. */
  fatal: Error | null = null;

  constructor(options: RecorderOptions) {
    this.mode = options.mode;
    this.dir = options.dir;
    this.now = options.now ?? (() => new Date());
  }

  pathFor(input: KeyInput): string {
    return join(this.dir, input.service, `${recordingKey(input)}.json`);
  }

  has(input: KeyInput): boolean {
    return existsSync(this.pathFor(input));
  }

  /** The stored response, or null when there is no recording. A malformed recording throws. */
  read<T>(input: KeyInput, validate: (value: unknown) => value is T): T | null {
    const path = this.pathFor(input);
    if (!existsSync(path)) return null;
    const stored = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredRecording<unknown>>;
    if (stored.model !== input.model || !validate(stored.response)) {
      throw this.fail(new Error(`Malformed recording ${input.service}/${recordingKey(input)}.json`));
    }
    return stored.response;
  }

  /** Record mode only. Refuses to write anything the secret scan flags. */
  write<T>(input: KeyInput, response: T): void {
    if (this.mode !== "record") throw new Error("Recordings are written only in record mode");
    const stored: StoredRecording<T> = { model: input.model, recordedAt: this.now().toISOString(), response };
    const text = `${JSON.stringify(stored, null, 2)}\n`;
    const problems = scanRecordingText(text);
    if (problems.length) {
      throw this.fail(new Error(`Refusing to save a ${input.service} recording: ${problems.join(", ")}`));
    }
    const path = this.pathFor(input);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  /** Replay: the recording or a hard error. Record: the recording, or a live call that is then saved. Live: a live call. */
  async call<T>(input: KeyInput, live: () => Promise<T>, validate: (value: unknown) => value is T): Promise<T> {
    if (this.mode !== "live") {
      const stored = this.read(input, validate);
      if (stored !== null) return stored;
      if (this.mode === "replay") throw this.fail(new ReplayMissError(input.service, recordingKey(input)));
    }
    this.liveCalls += 1;
    let response: T;
    try {
      response = await live();
    } catch (err) {
      throw this.fail(err instanceof Error ? err : new Error(String(err)));
    }
    if (!validate(response)) throw this.fail(new Error(`Live ${input.service} call returned an unexpected shape`));
    if (this.mode === "record") this.write(input, response);
    return response;
  }

  /** Remembers the first hard error and returns it. */
  fail(err: Error): Error {
    this.fatal ??= err;
    return err;
  }

  assertHealthy(): void {
    if (this.fatal) throw this.fatal;
  }
}
