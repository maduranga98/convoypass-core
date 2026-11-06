/** Linear-interpolation percentile of unsorted values (`p` in 0..1). `null` for no values; one value is itself. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] as number
  const b = sorted[hi] as number
  return a + (b - a) * (pos - lo)
}

export const median = (values: readonly number[]): number | null => percentile(values, 0.5)

/** One decimal, for minutes shown in reports. */
export const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10)

export const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole)

/** Deterministic string order (not locale dependent). */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
