import { dateKey } from '@/lib/dates'
import { daysInMonth, monthOfDateKey, nextMonth, pairingKey, type BlockReason, type GatePassBadgeStatus, type GatePassStatus } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'
import type { WithId } from '@/types'
import type { GatePass, QualificationEntry } from '@/types/gatePasses'
import type { EligibilityResult } from '@/types/penalties'

export type PassRow = WithId<GatePass>

const t = strings.gatePasses

/** The calendar month it is now in the company timezone: the same rule the server uses (`dateKey` -> `YYYY-MM`). */
export const currentMonthKey = (timezone: string, now: Date = new Date()): string => monthOfDateKey(dateKey(timezone, now))

export function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** "November 2026". */
export const monthLabel = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))

/** Months the admin can look at: next (being prepared), this one, and the one just ended. */
export const overviewMonths = (current: string): string[] => [nextMonth(current), current, previousMonth(current)]

export const isPast = (month: string, current: string): boolean => month < current

export const reasonText = (reason: BlockReason | null): string => (reason ? t.reason[reason] : '')

/** Status first (blocked passes need attention), then plate. */
const ORDER: Record<GatePassStatus, number> = { blocked: 0, active: 1, expired: 2 }
export const sortPasses = (rows: readonly PassRow[]): PassRow[] =>
  [...rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.plateNo.localeCompare(b.plateNo) || a.driverName.localeCompare(b.driverName))

export const countByStatus = (rows: readonly { status: GatePassStatus }[]): Record<GatePassStatus, number> => {
  const out: Record<GatePassStatus, number> = { active: 0, blocked: 0, expired: 0 }
  for (const r of rows) out[r.status]++
  return out
}

export function filterPasses(rows: readonly PassRow[], status: GatePassStatus | '', haystack: (r: PassRow) => string, search: string): PassRow[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((r) => (!status || r.status === status) && (words.length === 0 || words.every((w) => haystack(r).toLowerCase().includes(w))))
}

/**
 * What still stands in the way of a pass, read from the shared `checkEligibility` output (the same output the gate
 * consumes; nothing is re-derived). Empty = nothing is wrong any more, so the pass may be reactivated.
 */
export type UnresolvedCause = BlockReason | 'annual_inspection' | 'qualification'

export function unresolvedCauses(e: EligibilityResult): UnresolvedCause[] {
  const out: UnresolvedCause[] = []
  if (e.vehicle?.blocked || e.driver?.blocked) out.push('penalty')
  if (e.vehicle?.documentStatus === 'expired' || e.driver?.documentStatus === 'expired') out.push('document_expired')
  if (e.inspection && !e.inspection.cleared) out.push('inspection_invalidated')
  if (e.vehicle?.annualInspection && (e.vehicle.annualInspection === 'missing' || e.vehicle.annualInspection === 'expired')) out.push('annual_inspection')
  if (e.driver?.qualifications && !e.driver.qualifications.ok) out.push('qualification')
  return out
}

export const unresolvedText = (causes: readonly UnresolvedCause[]): string => causes.map((c) => (c === 'manual' ? t.reason.manual : t.unresolved[c])).join(' · ')

/** The pass the badge on a vehicle or driver shows: the current month's, best status first. */
export function badgeOf(passes: readonly { status: GatePassStatus; blockedReason: BlockReason | null }[]): { status: GatePassBadgeStatus; reason: BlockReason | null } {
  const active = passes.find((p) => p.status === 'active')
  if (active) return { status: 'active', reason: null }
  const blocked = passes.find((p) => p.status === 'blocked')
  if (blocked) return { status: 'blocked', reason: blocked.blockedReason }
  if (passes.some((p) => p.status === 'expired')) return { status: 'expired', reason: null }
  return { status: 'not_issued', reason: null }
}

// ---- Month-end selection -----------------------------------------------------------------------

export const entryKey = (e: Pick<QualificationEntry, 'vehicleId' | 'driverId'>): string => pairingKey(e.vehicleId, e.driverId)

export function toggleKey(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected)
  if (!next.delete(key)) next.add(key)
  return next
}

/** "Select all" selects every row of the list that is shown (a search narrows it); with all of them selected it clears them. */
export function toggleAll(selected: ReadonlySet<string>, shown: readonly string[]): Set<string> {
  const all = shown.length > 0 && shown.every((k) => selected.has(k))
  const next = new Set(selected)
  for (const k of shown) {
    if (all) next.delete(k)
    else next.add(k)
  }
  return next
}

/** Keys that are still on the list (a refresh may have dropped some). */
export const pruneSelection = (selected: ReadonlySet<string>, available: ReadonlySet<string>): Set<string> => new Set([...selected].filter((k) => available.has(k)))

/** Days until the list is due (last days of the month), for the helper text. */
export const daysLeftInMonth = (month: string, dateKeyToday: string): number => daysInMonth(month) - Number(dateKeyToday.slice(6, 8))
