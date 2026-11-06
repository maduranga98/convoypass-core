import type { Timestamp } from 'firebase/firestore'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { effectiveStatus, isBlocking, type PenaltyLike, type PenaltyStatus } from '@/lib/penaltyLogic'
import { strings } from '@/lib/strings'
import type { Penalty } from '@/types/penalties'
import type { WithId } from '@/types'

export type PenaltyRow = WithId<Penalty>

const t = strings.penalties

/** Which roles' screens a penalty list serves: the whole company (admin, Safety Officer) or one contractor (supervisor). */
export type PenaltyScope = 'admin' | 'safety' | 'supervisor'

export const endMs = (p: Pick<Penalty, 'duration'>): number | null => (p.duration.kind === 'fixed' ? p.duration.endDate.toMillis() : null)

/** The logic's view of a stored penalty (timestamps become milliseconds). */
export const toLike = (p: Penalty): PenaltyLike => ({
  status: p.status,
  target: p.target,
  duration: p.duration.kind === 'fixed' ? { kind: 'fixed', endDate: p.duration.endDate.toMillis() } : { kind: 'permanent' },
})

export const statusOf = (p: Penalty, nowMs: number): PenaltyStatus => effectiveStatus(toLike(p), nowMs)
export const blocksNow = (p: Penalty, nowMs: number): boolean => isBlocking(toLike(p), nowMs)

/** Waiting for a supervisor to confirm they have seen it (a revoked penalty needs no review). */
export const awaitingReview = (p: Penalty): boolean => p.verification.verifiedBy === null && p.status !== 'revoked'

export const scopeOf = (p: Penalty): 'driver' | 'vehicle' | 'both' => (p.target.driverId && p.target.vehicleId ? 'both' : p.target.vehicleId ? 'vehicle' : 'driver')

/** "WP LJ-4821", "Dan Driver" or "WP LJ-4821 · Dan Driver". */
export const targetText = (p: Penalty): string => [p.targetLabels.plateNo, p.targetLabels.driverName].filter(Boolean).join(' · ') || strings.common.none

const dayFormat = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export const formatDay = (ms: number, tz = DEFAULT_TIMEZONE): string => dayFormat(tz).format(ms)
export const formatDateTime = (ts: Timestamp | null | undefined, tz = DEFAULT_TIMEZONE): string => (ts ? timeFormat(tz).format(ts.toMillis()) : strings.common.none)

/** "Permanent", "Until 12 Mar 2026" or, once over, "Ended 12 Mar 2026". */
export function durationText(p: Penalty, tz: string, nowMs: number): string {
  const end = endMs(p)
  if (end === null) return t.permanent
  return nowMs > end ? t.endedOn(formatDay(end, tz)) : t.endsOn(formatDay(end, tz))
}

/** Review state in words: awaiting a supervisor, or who confirmed and when. */
export function reviewText(p: Penalty, tz: string): string {
  if (p.verification.verifiedBy === null) return p.status === 'revoked' ? strings.common.none : t.reviewState.awaiting
  return t.reviewState.by(p.verification.verifiedByName ?? strings.common.none, formatDateTime(p.verification.verifiedAt, tz))
}

/** Newest first. */
export const byIssuedDesc = (a: PenaltyRow, b: PenaltyRow): number => b.issuedAt.toMillis() - a.issuedAt.toMillis()
