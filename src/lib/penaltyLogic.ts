// Keep in sync with functions/src/penaltyLogic.ts (src/lib/penaltyLogic.test.ts compares them).
// Pure: no firebase imports. The ONE place that decides whether a penalty blocks, expires, and how it combines with the
// document status of Module 2. Times are milliseconds since epoch.
import type { EligibilityStatus } from './expiry'

export const PENALTY_STATUSES = ['active', 'expired', 'revoked'] as const
export type PenaltyStatus = (typeof PENALTY_STATUSES)[number]

export type PenaltyDurationMs = { kind: 'fixed'; endDate: number } | { kind: 'permanent' }

export interface PenaltyTarget {
  driverId: string | null
  vehicleId: string | null
}

/** What the logic needs from a penalty. */
export interface PenaltyLike {
  status: PenaltyStatus
  target: PenaltyTarget
  duration: PenaltyDurationMs
}

export const PENALTY_TYPE_NAME_MIN = 2
export const PENALTY_TYPE_NAME_MAX = 40
export const MAX_PENALTY_TYPES = 50
export const PENALTY_REASON_MIN = 5
export const PENALTY_REASON_MAX = 1000
export const PENALTY_NOTE_MAX = 500
/** A fixed penalty may end at most this many days from today. */
export const PENALTY_MAX_DAYS = 3650

/**
 * An active penalty blocks until the END of its last day. A fixed one whose end has passed no longer blocks even if the
 * scheduled job has not flipped its status yet, so checks stay correct between runs.
 */
export function isBlocking(p: Pick<PenaltyLike, 'status' | 'duration'>, nowMs: number): boolean {
  if (p.status !== 'active') return false
  return p.duration.kind === 'permanent' || nowMs <= p.duration.endDate
}

/** What to show: a stored `active` penalty past its last day reads as `expired` even before the scheduled job flips it. */
export function effectiveStatus(p: Pick<PenaltyLike, 'status' | 'duration'>, nowMs: number): PenaltyStatus {
  return p.status === 'active' && !isBlocking(p, nowMs) ? 'expired' : p.status
}

/** True for an active fixed penalty whose end date has passed: the scheduled job flips it to `expired`. */
export function shouldExpire(p: Pick<PenaltyLike, 'status' | 'duration'>, nowMs: number): boolean {
  return p.status === 'active' && p.duration.kind === 'fixed' && nowMs > p.duration.endDate
}

/** A penalty applies to a vehicle or driver when it names that record (a penalty on both applies to each). */
export const targetsRecord = (t: PenaltyTarget, ref: { vehicleId?: string | null; driverId?: string | null }): boolean =>
  (!!ref.vehicleId && t.vehicleId === ref.vehicleId) || (!!ref.driverId && t.driverId === ref.driverId)

/** Every penalty that currently blocks the vehicle and/or the driver. */
export function blockingPenalties<T extends PenaltyLike>(
  penalties: readonly T[],
  ref: { vehicleId?: string | null; driverId?: string | null },
  nowMs: number,
): T[] {
  return penalties.filter((p) => isBlocking(p, nowMs) && targetsRecord(p.target, ref))
}

/** `blocked` overrides everything; otherwise the worst document status (expired > expiringSoon > valid). */
export type CombinedStatus = 'blocked' | EligibilityStatus

export function combineStatus(blocked: boolean, documents: readonly (EligibilityStatus | null | undefined)[]): CombinedStatus {
  if (blocked) return 'blocked'
  if (documents.includes('expired')) return 'expired'
  if (documents.includes('expiringSoon')) return 'expiringSoon'
  return 'valid'
}

/** Offset of `timezone` from UTC at instant `t`, in ms (wall clock minus UTC). */
function offsetMs(timezone: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t))
  const n = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(t / 1000) * 1000
}

/**
 * The last millisecond of calendar day `iso` (`YYYY-MM-DD`) in `timezone`: a penalty "until 30 June" blocks through the
 * end of 30 June there, whatever the server's own zone.
 */
export function endOfDayMs(timezone: string, iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const nextMidnightAsUtc = Date.UTC(y, m - 1, d + 1)
  // Two passes settle the offset when it changes (DST) between the guess and the answer.
  let instant = nextMidnightAsUtc - offsetMs(timezone, nextMidnightAsUtc)
  instant = nextMidnightAsUtc - offsetMs(timezone, instant)
  return instant - 1
}
