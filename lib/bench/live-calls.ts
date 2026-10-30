// Bench-only wrapper around every live call a record or live run makes: a
// per-call timeout, bounded retries with exponential backoff (record runs
// only), one progress line per attempt and a final tally. Nothing here is
// imported by the app, so the timeouts and retries the API routes use are
// untouched. Log lines carry the case id, service, attempt, elapsed time and a
// fixed outcome label; never a key, header, URL, payload or error text.
//   SAFELABS_BENCH_TIMEOUT_MS  per-call timeout; unset keeps each client's own (SAM/Voice 10 s, Spark 20 s)
//   SAFELABS_BENCH_RETRIES     retries after the first attempt on a timeout, 5xx or 429 (default 2, record only)

import { MetaApiError } from "../meta/http";

export const DEFAULT_BENCH_RETRIES = 2;
const MAX_BENCH_RETRIES = 10;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;

type Env = Record<string, string | undefined>;

function wholeNumber(raw: string | undefined, name: string, min: number, max: number): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

/** SAFELABS_BENCH_TIMEOUT_MS, or undefined to keep each client's current timeout. */
export function benchTimeoutMs(env: Env = process.env): number | undefined {
  return wholeNumber(env.SAFELABS_BENCH_TIMEOUT_MS, "SAFELABS_BENCH_TIMEOUT_MS", 1_000, 600_000);
}

export function benchRetries(env: Env = process.env): number {
  return wholeNumber(env.SAFELABS_BENCH_RETRIES, "SAFELABS_BENCH_RETRIES", 0, MAX_BENCH_RETRIES) ?? DEFAULT_BENCH_RETRIES;
}

/** A live client reported failure as data (SAM/Voice "unavailable"); `detail` is its own safe error text. */
export class LiveCallDetailError extends Error {
  constructor(message: string, readonly detail: string) {
    super(message);
    this.name = "LiveCallDetailError";
  }
}

export interface FailureClass {
  /** Fixed label for logs: "timeout", "http-503", "SparkReplyError:schema", ... */
  code: string;
  timeout: boolean;
  /** A timeout, 429 or 5xx: worth another attempt on a record run. */
  transient: boolean;
}

function httpClass(status: number): FailureClass {
  return { code: `http-${status}`, timeout: false, transient: status === 429 || status >= 500 };
}

export function classifyLiveError(err: unknown): FailureClass {
  if (err instanceof LiveCallDetailError) {
    if (/^timed out/i.test(err.detail)) return { code: "timeout", timeout: true, transient: true };
    const status = /^HTTP (\d{3})\b/.exec(err.detail);
    if (status) return httpClass(Number(status[1]));
    return { code: "error", timeout: false, transient: false };
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { code: "timeout", timeout: true, transient: true };
  }
  if (err instanceof MetaApiError && err.status !== undefined) return httpClass(err.status);
  if (err instanceof Error) {
    const failure = (err as { failure?: unknown }).failure;
    return { code: typeof failure === "string" ? `${err.name}:${failure}` : err.name || "error", timeout: false, transient: false };
  }
  return { code: "error", timeout: false, transient: false };
}

export interface LiveAttempt {
  /** Per-call timeout to apply, or undefined to keep the client's own. */
  timeoutMs: number | undefined;
  /** 1-based. */
  attempt: number;
}

export interface FirstFailure {
  caseId: string | null;
  service: string;
  code: string;
  attempts: number;
}

export interface LiveCallStats {
  /** Live calls that returned a usable response. */
  made: number;
  /** Recordings reused instead of calling. */
  reused: number;
  failed: number;
}

export interface LiveCallRunnerOptions {
  timeoutMs?: number;
  /** Retries after the first attempt. Default 0: the Recorder retries only when bench.ts asks for it. */
  retries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** One line per attempt; omitted = silent. */
  log?: (line: string) => void;
}

export interface LiveCallContext {
  service: string;
  caseId: string | null;
  /** The response is saved as a recording (record mode); false for a live run. */
  saves: boolean;
}

export class LiveCallRunner {
  readonly stats: LiveCallStats = { made: 0, reused: 0, failed: 0 };
  firstFailure: FirstFailure | null = null;
  private readonly timeoutMs: number | undefined;
  private readonly retries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(options: LiveCallRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs;
    this.retries = options.retries ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? (() => {});
  }

  private line(caseId: string | null, service: string, detail: string): void {
    this.log(`bench ${caseId ?? "-"} ${service} ${detail}`);
  }

  /** Counts one recording reused; `log` false when the caller reports a group with logReused(). */
  noteReused(service: string, caseId: string | null, log = true): void {
    this.stats.reused += 1;
    if (log) this.line(caseId, service, "reused");
  }

  /** One progress line for a group of recordings already counted by noteReused(). */
  logReused(service: string, caseId: string | null, count: number): void {
    if (count > 0) this.line(caseId, service, `reused x${count}`);
  }

  /**
   * Runs `attempt` until it returns, a non-transient error, or the retries are
   * used up. `accept` validates and saves the response; it runs once, after a
   * successful response, and its errors are never retried. A failed call has
   * therefore written nothing.
   */
  async run<T>(ctx: LiveCallContext, attempt: (a: LiveAttempt) => Promise<T>, accept: (value: T) => void): Promise<T> {
    const total = this.retries + 1;
    for (let n = 1; ; n++) {
      const started = this.now();
      const label = `attempt ${n}/${total}`;
      let value: T;
      try {
        value = await attempt({ timeoutMs: this.timeoutMs, attempt: n });
      } catch (err) {
        const failure = classifyLiveError(err);
        const elapsed = this.now() - started;
        const again = failure.transient && n < total;
        this.line(ctx.caseId, ctx.service, `${label} ${elapsed}ms ${failure.code}${again ? " (retrying)" : ""}`);
        if (!again) {
          this.fail(ctx, failure.code, n);
          throw err;
        }
        await this.sleep(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1)));
        continue;
      }
      const elapsed = this.now() - started;
      try {
        accept(value);
      } catch (err) {
        this.line(ctx.caseId, ctx.service, `${label} ${elapsed}ms ${classifyLiveError(err).code}`);
        this.fail(ctx, classifyLiveError(err).code, n);
        throw err;
      }
      this.stats.made += 1;
      this.line(ctx.caseId, ctx.service, `${label} ${elapsed}ms ${ctx.saves ? "recorded" : "ok (not saved)"}`);
      return value;
    }
  }

  private fail(ctx: LiveCallContext, code: string, attempts: number): void {
    this.stats.failed += 1;
    this.firstFailure ??= { caseId: ctx.caseId, service: ctx.service, code, attempts };
  }

  summaryLines(): string[] {
    const { made, reused, failed } = this.stats;
    const lines = [`Live calls: ${made} made, ${reused} reused, ${failed} failed.`];
    const f = this.firstFailure;
    if (f) {
      lines.push(
        `Run stopped at case ${f.caseId ?? "-"} (${f.service}): ${f.code} after ${f.attempts} attempt${f.attempts === 1 ? "" : "s"}. ` +
          "No recording was written for it; re-run to continue from here.",
      );
    }
    return lines;
  }
}
