import { visitorStrings } from '@/lib/visitorStrings'

/** `2026-03-10` or `2026-03-10 to 2026-03-12`. */
export const validLabel = (from: string, until: string): string => visitorStrings.validRange(from, until)

/** `YYYY-MM-DD` of an instant, in the viewer's own calendar (a gate is where its users are). */
export const isoDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
export const stamp = (ms: number): string => `${isoDay(ms)} ${hhmm(ms)}`

/** Whole hours and the minutes left over (never negative). */
export function elapsedParts(fromMs: number, toMs: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor((toMs - fromMs) / 60_000))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}
