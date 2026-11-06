// Keep in sync with functions/src/dates.ts (functions deploy from their own folder).

export const DEFAULT_TIMEZONE = 'Asia/Colombo'

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * `YYYYMMDD` of `date` in `timezone` (an IANA name). This is the single place that decides what "a day" means for
 * a pass, so a per-trip or per-shift scheme can replace it later. Falls back to the default timezone when the
 * given one is not valid.
 */
export function dateKey(timezone: string, date: Date = new Date()): string {
  const timeZone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}
