// Keep in sync with src/lib/expiry.ts (functions deploy from their own folder; src/lib/expiry.test.ts compares them).
// Pure: no firebase imports. Expiry dates are calendar dates (`YYYY-MM-DD`), valid through the end of that day.

export const ELIGIBILITY_STATUSES = ['valid', 'expiringSoon', 'expired'] as const
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number]

export const DEFAULT_EXPIRY_WARNING_DAYS = 14
export const MIN_EXPIRY_WARNING_DAYS = 1
export const MAX_EXPIRY_WARNING_DAYS = 90

export const EXPIRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isExpiryDate(v: unknown): v is string {
  if (typeof v !== 'string' || !EXPIRY_DATE_PATTERN.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** `YYYYMMDD` (the pass dateKey) -> `YYYY-MM-DD`. */
export const isoFromDateKey = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

const dayNumber = (iso: string): number => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86_400_000)

/** Whole days from `today` to `expiry` (negative = already past). */
export const daysUntil = (expiry: string, today: string): number => dayNumber(expiry) - dayNumber(today)

/** The configured window, or the default when absent or out of range. */
export const warningDaysOf = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MIN_EXPIRY_WARNING_DAYS && v <= MAX_EXPIRY_WARNING_DAYS
    ? v
    : DEFAULT_EXPIRY_WARNING_DAYS

/**
 * Worst status over the tracked dates. A date that is missing is not tracked (legacy records have none), so a record
 * with no dates at all is `valid`. Valid through the end of the expiry day: it is `expired` from the next day.
 * `expiringSoon` = expires within `warningDays` days (today included).
 */
export function computeEligibility(
  dates: readonly (string | null | undefined)[],
  today: string,
  warningDays: number,
): EligibilityStatus {
  let status: EligibilityStatus = 'valid'
  for (const date of dates) {
    if (!isExpiryDate(date)) continue
    const left = daysUntil(date, today)
    if (left < 0) return 'expired'
    if (left <= warningDays) status = 'expiringSoon'
  }
  return status
}
