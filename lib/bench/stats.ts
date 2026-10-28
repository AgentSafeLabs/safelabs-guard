// Counts with Wilson score intervals (95%). Deterministic, rounded output.

export interface Rate {
  k: number;
  n: number;
  /** k / n, 4 decimals; null when n = 0. */
  rate: number | null;
  /** Wilson 95% interval, 4 decimals; null when n = 0. */
  low: number | null;
  high: number | null;
}

const Z95 = 1.959963984540054;

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export function wilson(k: number, n: number, z = Z95): { low: number; high: number } | null {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) throw new Error(`bad count ${k}/${n}`);
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: round4(Math.max(0, centre - half)), high: round4(Math.min(1, centre + half)) };
}

export function rate(k: number, n: number): Rate {
  const ci = wilson(k, n);
  return { k, n, rate: n ? round4(k / n) : null, low: ci?.low ?? null, high: ci?.high ?? null };
}

/** "3/10 (30%, 95% CI 11-60%)" or "0/0 (n/a)". */
export function formatRate(r: Rate): string {
  if (r.n === 0 || r.rate === null || r.low === null || r.high === null) return `${r.k}/${r.n} (n/a)`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return `${r.k}/${r.n} (${pct(r.rate)}, CI ${pct(r.low)}-${pct(r.high)})`;
}
