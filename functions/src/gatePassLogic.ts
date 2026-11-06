// Keep in sync with src/lib/gatePassLogic.ts (functions deploy from their own folder; src/lib/gatePassLogic.test.ts
// compares them). Pure: no firebase imports. The ONE place that decides what a monthly gate pass means: its ids, its
// month, why it blocks and what the gate shows for a vehicle + driver pairing. Times are milliseconds since epoch.
import type { InvalidationReason } from './inspectionLogic.js'

export const GATE_PASS_STATUSES = ['active', 'blocked', 'expired'] as const
export type GatePassStatus = (typeof GATE_PASS_STATUSES)[number]

/**
 * Why an active pass was blocked. The first three are set by the system when a condition fails mid-month; `manual` is the
 * Company Admin blocking a pass on purpose (a note is required).
 */
export const BLOCK_REASONS = ['penalty', 'document_expired', 'inspection_invalidated', 'manual'] as const
export type BlockReason = (typeof BLOCK_REASONS)[number]

export const MANUAL_BLOCK_NOTE_MIN = 5
export const MANUAL_BLOCK_NOTE_MAX = 500

/** A pass of the pairing's calendar month, in the company's timezone: `YYYY-MM`. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const isValidMonth = (m: unknown): m is string => typeof m === 'string' && MONTH_PATTERN.test(m)

/** `YYYY-MM` of a `YYYYMMDD` day key (`dateKey(timezone, date)`). */
export const monthOfDateKey = (dateKey: string): string => `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}`

/** The month after `month` (`2026-12` -> `2027-01`). */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function daysInMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
}

/**
 * One pass per vehicle + driver pairing per month, so the Firestore id is the pairing: creating it twice cannot make
 * two passes. Vehicle ids are `veh_…` and driver ids are Auth uids, neither contains `/`.
 */
export const gatePassId = (month: string, vehicleId: string, driverId: string): string => `${month}_${vehicleId}_${driverId}`

/** The qualification entry of a pairing (the month lives in the parent document). */
export const pairingKey = (vehicleId: string, driverId: string): string => `${vehicleId}_${driverId}`

/** How many days at the end of a month the qualification list is (re)computed daily. */
export const QUALIFICATION_WINDOW_DAYS = 4

/** Is `dateKey` (`YYYYMMDD`, company timezone) within the last days of its month? */
export function inQualificationWindow(dateKey: string): boolean {
  const month = monthOfDateKey(dateKey)
  return Number(dateKey.slice(6, 8)) > daysInMonth(month) - QUALIFICATION_WINDOW_DAYS
}

/** Which months may a pass be issued for: the current one (catch-up) and the next one (the normal month-end run). */
export const issuableMonths = (currentMonth: string): [string, string] => [currentMonth, nextMonth(currentMonth)]

/** What the clearance of a vehicle means for its passes. A penalty or an expired document that cancelled the inspection keeps its own reason. */
export function blockReasonForClearance(reason: InvalidationReason | null | undefined): BlockReason {
  if (reason === 'penalty_issued') return 'penalty'
  if (reason === 'document_expired') return 'document_expired'
  return 'inspection_invalidated'
}

/** Only an active pass of this month or a later one is blocked; a past month's pass is simply over. */
export const isBlockable = (p: { status: GatePassStatus; month: string }, currentMonth: string): boolean => p.status === 'active' && p.month >= currentMonth

/** Only a blocked pass of this month or a later one can be brought back; an old one needs a new pass. */
export const isReactivatable = (p: { status: GatePassStatus; month: string }, currentMonth: string): boolean => p.status === 'blocked' && p.month >= currentMonth

/** What the gate sees for one vehicle + driver pairing this month. */
export type GatePassCheck =
  | { state: 'active' }
  /** No pass for this month and never one before. */
  | { state: 'none'; month: string }
  | { state: 'blocked'; month: string; reason: BlockReason }
  /** The pairing had a pass, but it covered an earlier month (or was marked over). Needs a new pass. */
  | { state: 'expired'; month: string }

/**
 * `current` is the pairing's pass for the current month (null = none); `hadEarlier` = it had a pass for an earlier month.
 * Only an `active` pass lets the vehicle in.
 */
export function gatePassCheck(current: { status: GatePassStatus; blockedReason?: BlockReason | null | undefined } | null, hadEarlier: boolean, month: string): GatePassCheck {
  if (!current) return hadEarlier ? { state: 'expired', month } : { state: 'none', month }
  if (current.status === 'active') return { state: 'active' }
  if (current.status === 'blocked') return { state: 'blocked', month, reason: current.blockedReason ?? 'manual' }
  return { state: 'expired', month }
}

/** The status the UI shows for a vehicle or driver ("Not issued" = no pass for the month). */
export type GatePassBadgeStatus = GatePassStatus | 'not_issued'

export function badgeStatusOf(passes: readonly { status: GatePassStatus }[]): GatePassBadgeStatus {
  if (passes.some((p) => p.status === 'active')) return 'active'
  if (passes.some((p) => p.status === 'blocked')) return 'blocked'
  if (passes.some((p) => p.status === 'expired')) return 'expired'
  return 'not_issued'
}

// ---- Stored shapes (times in milliseconds; the Firestore port converts them) ----------------------------------------

export interface GatePassData {
  tenantId: string
  vehicleId: string
  driverId: string
  /** Derived from the vehicle at issue time: lets a supervisor read their own contractor's passes. */
  contractorId: string
  /** Names at issue time, so lists and the audit trail stay readable. */
  plateNo: string
  driverName: string
  /** `YYYY-MM` in the company timezone. */
  month: string
  status: GatePassStatus
  issuedAt: number
  /** The Company Admin who issued it; `system` for an automatic month-rollover issue. */
  issuedBy: { uid: string; name: string }
  issueMode: 'manual' | 'auto'
  blockedReason: BlockReason | null
  blockedAt: number | null
  /** Required for a manual block; null otherwise. */
  blockNote: string | null
  /** The last reactivation (the pass keeps working after it; this only says who brought it back, and from what). */
  reactivation: { by: { uid: string; name: string }; at: number; previousReason: BlockReason | null } | null
  expiredAt: number | null
  createdAt?: number | undefined
  updatedAt?: number | undefined
}

export type GatePassRecord = GatePassData & { id: string }

/** One pairing on the month-end list: eligible now, no pass for the month yet. */
export interface QualificationEntry {
  tenantId: string
  month: string
  vehicleId: string
  driverId: string
  contractorId: string
  contractorName: string
  plateNo: string
  driverName: string
  /** Worst document status of the two records when the list was computed (`valid` or `expiringSoon`). */
  documentStatus: 'valid' | 'expiringSoon'
  computedAt: number
}

/** `monthEndQualification/{tenantId}_{month}`: the summary of one computation; the entries are its subcollection. */
export interface QualificationMeta {
  tenantId: string
  month: string
  computedAt: number
  trigger: 'schedule' | 'manual' | 'auto'
  /** Pairings looked at (active vehicle, contractor and driver). */
  evaluatedCount: number
  qualifiedCount: number
  alreadyIssuedCount: number
  notEligibleCount: number
  /** Pairings whose check could not be completed (retry later). */
  failedCount: number
  /** True when the company has more pairings than one computation reads. */
  truncated: boolean
}

export const qualificationId = (tenantId: string, month: string): string => `${tenantId}_${month}`
