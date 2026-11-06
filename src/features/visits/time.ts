/** `HH:MM` in the viewer's locale. */
export const clock = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** `2026-03-10 14:05` in the viewer's locale (the tenant's wall clock is the viewer's in practice: a gate is where its users are). */
export const dateTime = (ms: number): string =>
  `${new Date(ms).toLocaleDateString()} ${clock(ms)}`

/** Whole hours and the minutes left over between two instants (never negative). */
export function elapsed(fromMs: number, toMs: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor((toMs - fromMs) / 60_000))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}
