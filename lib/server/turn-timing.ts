// Per-stage wall-clock timing for one agent turn. Records stage names and
// millisecond durations only: no keys, payloads, transcripts or image text.

export type TimedStage = "sam" | "ocr" | "voice" | "spark" | "guard";

const ORDER: readonly TimedStage[] = ["voice", "sam", "ocr", "spark", "guard"];

export class TurnTimings {
  private readonly ms: Partial<Record<TimedStage, number>> = {};
  private readonly startedAt: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  /** Runs fn and adds its duration to the stage. Works for sync and async fn; passes results and errors through. */
  time<T>(stage: TimedStage, fn: () => T): T {
    const t0 = this.now();
    const done = () => {
      this.ms[stage] = (this.ms[stage] ?? 0) + (this.now() - t0);
    };
    let out: T;
    try {
      out = fn();
    } catch (err) {
      done();
      throw err;
    }
    if (out && typeof (out as { then?: unknown }).then === "function") {
      return (out as unknown as Promise<unknown>).finally(done) as unknown as T;
    }
    done();
    return out;
  }

  private entries(): [string, number][] {
    const out: [string, number][] = [];
    for (const stage of ORDER) {
      const v = this.ms[stage];
      if (v !== undefined) out.push([stage, v]);
    }
    out.push(["total", this.now() - this.startedAt]);
    return out;
  }

  /** Value for a Server-Timing header, e.g. `sam;dur=812.3, total;dur=2410.0`. */
  serverTiming(): string {
    return this.entries()
      .map(([name, v]) => `${name};dur=${v.toFixed(1)}`)
      .join(", ");
  }

  /** One log line, e.g. `agent turn timing mode=guarded turn=2 sam=812ms total=2410ms`. */
  logLine(mode: string, turn: number): string {
    return `agent turn timing mode=${mode} turn=${turn} ${this.entries()
      .map(([name, v]) => `${name}=${Math.round(v)}ms`)
      .join(" ")}`;
  }
}
