import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/dates'

/** How far the wall clock in `timeZone` is ahead of UTC at instant `ms`, in milliseconds. */
function offsetAt(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(ms / 1000) * 1000
}

/** Midnight of `YYYYMMDD` in `timeZone`, as epoch milliseconds (two passes settle DST changes). */
function zonedMidnight(timeZone: string, y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m, d)
  const first = guess - offsetAt(timeZone, guess)
  return guess - offsetAt(timeZone, first)
}

/** `[start, end)` of a day (`YYYYMMDD`) in the tenant timezone: the same notion of "a day" as `dateKey`. */
export function dayRange(timezone: string, key: string): { start: number; end: number } {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(4, 6)) - 1
  const d = Number(key.slice(6, 8))
  return { start: zonedMidnight(tz, y, m, d), end: zonedMidnight(tz, y, m, d + 1) }
}
