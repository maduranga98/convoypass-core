/** Offset (ms) of `timeZone` from UTC at instant `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcMs)
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(utcMs / 1000) * 1000
}

/** The instant a calendar day (`YYYY-MM-DD`) starts in an IANA timezone (handles DST by iterating once). */
export function dayStartMs(day: string, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const wallAsUtc = Date.UTC(y, m - 1, d)
  let guess = wallAsUtc - offsetMs(wallAsUtc, timeZone)
  guess = wallAsUtc - offsetMs(guess, timeZone)
  return guess
}

/** `[from 00:00, to + 1 day 00:00)` in the timezone. */
export function rangeMs(from: string, to: string, timeZone: string): { startMs: number; endMs: number } {
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  return { startMs: dayStartMs(from, timeZone), endMs: dayStartMs(next, timeZone) }
}
