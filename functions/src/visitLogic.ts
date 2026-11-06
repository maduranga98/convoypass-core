// Visit lifecycle rules in ONE pure place (no firebase imports). Mirrored in src/lib/visitLogic.ts for the web app
// (functions deploy from their own folder; src/lib/visitLogic.test.ts compares the copies). A visit has three stages:
// check-in (Security), unloading check (Yard Officer), check-out (Security).

export const VISIT_STATUSES = ['checked_in', 'checked_out'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]

/**
 * The dwell limit is a company setting, not a constant: `tenants.dwellLimitHours`, default 16. OPEN ITEM (client sign-off):
 * what happens at the limit (flag only / block / alert) and whether it is measured strictly from check-in. Today it only
 * sets `dwellWarning` on the visit and shows an alert; nothing is blocked.
 */
export const DEFAULT_DWELL_LIMIT_HOURS = 16
export const MIN_DWELL_LIMIT_HOURS = 1
export const MAX_DWELL_LIMIT_HOURS = 72

export const UNLOAD_LOCATION_MIN = 2
export const UNLOAD_LOCATION_MAX = 60

const HOUR_MS = 60 * 60 * 1000

/** The company's dwell limit in hours, or the default when unset or out of range. */
export function dwellLimitHoursOf(tenant: { dwellLimitHours?: number | undefined } | null | undefined): number {
  const v = tenant?.dwellLimitHours
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_DWELL_LIMIT_HOURS && v <= MAX_DWELL_LIMIT_HOURS ? v : DEFAULT_DWELL_LIMIT_HOURS
}

/** True for a whole number of hours inside the allowed range (the settings form and the callable agree on this). */
export const dwellLimitOk = (hours: number): boolean => Number.isInteger(hours) && hours >= MIN_DWELL_LIMIT_HOURS && hours <= MAX_DWELL_LIMIT_HOURS

/** The instant (ms) a visit checked in at `checkInMs` reaches the limit. */
export const dwellDueAt = (checkInMs: number, limitHours: number): number => checkInMs + limitHours * HOUR_MS

/** True once a visit that is still checked in has been on site for `limitHours` or longer (measured from check-in). */
export function isDwellExceeded(visit: { status: VisitStatus; checkInAt: number }, nowMs: number, limitHours: number): boolean {
  return visit.status === 'checked_in' && nowMs >= dwellDueAt(visit.checkInAt, limitHours)
}

/** The tiles of the daily summary. The server returns only the ones a role may see. */
export const SUMMARY_METRICS = ['checkIns', 'unloads', 'checkOuts', 'onSite', 'awaitingUnload', 'suspensions', 'dwellWarnings'] as const
export type SummaryMetric = (typeof SUMMARY_METRICS)[number]

/** Role-filtered content of the shared daily summary: what each role needs at a glance, nothing it has no use for. */
export const SUMMARY_BY_ROLE: Record<string, readonly SummaryMetric[]> = {
  admin: SUMMARY_METRICS,
  officer: SUMMARY_METRICS,
  supervisor: SUMMARY_METRICS,
  security: ['checkIns', 'checkOuts', 'onSite', 'dwellWarnings'],
  yard: ['unloads', 'awaitingUnload', 'onSite', 'dwellWarnings'],
  safety: ['checkIns', 'suspensions', 'dwellWarnings'],
}

export const summaryMetricsFor = (role: string): readonly SummaryMetric[] => SUMMARY_BY_ROLE[role] ?? []

/**
 * Gate time: a vehicle may enter and leave as often as it likes until `hours` have passed since its FIRST check-in of the
 * day (the pass check-in). After that no new entry is accepted; a check-out is always accepted. `hours` is the company's
 * dwell limit (`dwellLimitHoursOf`, default 16).
 */
export const gateTimeEndsAt = (firstCheckInMs: number, hours: number): number => dwellDueAt(firstCheckInMs, hours)
export const withinGateTime = (firstCheckInMs: number, nowMs: number, hours: number): boolean => nowMs < gateTimeEndsAt(firstCheckInMs, hours)
