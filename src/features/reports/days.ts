// Calendar-day arithmetic on `YYYY-MM-DD` strings (no timezone involved: "today" comes from the tenant timezone).

const RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date in `YYYY-MM-DD` form. */
export function isDay(value: string | null | undefined): value is string {
  if (!value) return false
  const m = RE.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return y >= 2000 && probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
}

export function addDays(day: string, n: number): string {
  const m = RE.exec(day)
  if (!m) throw new Error(`bad day ${day}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10)
}

/** Days from `from` to `to`, both included. */
export function inclusiveDays(from: string, to: string): number {
  const t = (d: string): number => Date.parse(`${d}T00:00:00Z`)
  return Math.round((t(to) - t(from)) / 86_400_000) + 1
}

export const MAX_RANGE_DAYS = 92
