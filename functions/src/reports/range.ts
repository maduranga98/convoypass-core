// Date ranges for reports: `YYYY-MM-DD` strings in the tenant timezone -> dateKeys and timestamp boundaries.
import { DEFAULT_TIMEZONE, isValidTimezone } from '../dates.js'

export const MAX_RANGE_DAYS = 92

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface Ymd {
  y: number
  m: number
  d: number
}

/** A real calendar date (2026-02-30 is refused), or null. */
export function parseDay(value: string): Ymd | null {
  const match = DAY_RE.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (y < 2000 || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return { y, m, d }
}

/** `2026-03-09` -> `20260309`. */
export const toDateKey = (day: string): string => day.replaceAll('-', '')

/** `20260309` -> `2026-03-09`. */
export const fromDateKey = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

const dayNumber = ({ y, m, d }: Ymd): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)

/** Days from `from` to `to`, both included. */
export const inclusiveDays = (from: Ymd, to: Ymd): number => dayNumber(to) - dayNumber(from) + 1

/** `YYYY-MM-DD` of the day `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  const p = parseDay(day)
  if (!p) throw new Error(`bad day ${day}`)
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10)
}

export type RangeProblem = 'invalid-date' | 'order' | 'too-long'

export type RangeCheck = { ok: true; days: number } | { ok: false; problem: RangeProblem }

export function checkRange(from: string, to: string): RangeCheck {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return { ok: false, problem: 'invalid-date' }
  const days = inclusiveDays(a, b)
  if (days < 1) return { ok: false, problem: 'order' }
  if (days > MAX_RANGE_DAYS) return { ok: false, problem: 'too-long' }
  return { ok: true, days }
}

const tzOf = (timezone: string): string => (isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE)

/** How far the wall clock in `timeZone` is ahead of UTC at instant `ms`. */
function offsetAt(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(ms / 1000) * 1000
}

/** Midnight at the start of `day` in `timezone`, epoch milliseconds (two passes settle DST changes). */
export function dayStartMs(timezone: string, day: string): number {
  const p = parseDay(day)
  if (!p) throw new Error(`bad day ${day}`)
  const tz = tzOf(timezone)
  const guess = Date.UTC(p.y, p.m - 1, p.d)
  const first = guess - offsetAt(tz, guess)
  return guess - offsetAt(tz, first)
}

export interface RangeBounds {
  fromKey: string
  toKey: string
  /** Inclusive. */
  startMs: number
  /** Exclusive: midnight after the last day. */
  endMs: number
}

/** `[start, end)` of the inclusive day range in the tenant timezone. Assumes `checkRange` passed. */
export function rangeBounds(timezone: string, from: string, to: string): RangeBounds {
  return {
    fromKey: toDateKey(from),
    toKey: toDateKey(to),
    startMs: dayStartMs(timezone, from),
    endMs: dayStartMs(timezone, addDays(to, 1)),
  }
}

/** `yyyy-MM-dd HH:mm` in the timezone. */
export function formatLocal(timezone: string, ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone: tzOf(timezone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** The `YYYY-MM-DD` of an instant in the timezone. */
export const localDay = (timezone: string, ms: number): string => formatLocal(timezone, ms).slice(0, 10)
