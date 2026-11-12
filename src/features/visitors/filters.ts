import { effectiveStatus, isOverstay } from '@/lib/visitorLogic'
import type { WithId } from '@/types'
import type { VisitorPass } from '@/types/visitors'

export type StatusFilter = 'all' | 'active' | 'checked_in' | 'checked_out' | 'expired' | 'revoked' | 'over'
export type RangeFilter = 'all' | 'today' | 'week' | 'month'

const DAY = 86_400_000
const RANGE_MS: Record<Exclude<RangeFilter, 'all' | 'today'>, number> = { week: 7 * DAY, month: 30 * DAY }

/** Start of the viewer's calendar day. */
export const startOfToday = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Is this pass shown by the filters? `now` makes "valid" mean what it means on the gate: an unflipped pass past its end is Expired. */
export function matchesPass(p: WithId<VisitorPass>, f: { status: StatusFilter; range: RangeFilter; needle: string }, now: number): boolean {
  const status = effectiveStatus({ status: p.status, validUntil: p.validUntil.toMillis() }, now)
  if (f.status === 'over') {
    if (!isOverstay({ status: p.status, checkInAt: p.checkInAt?.toMillis() ?? null, maxDwellMinutes: p.maxDwellMinutes }, now)) return false
  } else if (f.status !== 'all' && status !== f.status) return false
  if (f.range !== 'all') {
    const from = f.range === 'today' ? startOfToday(now) : now - RANGE_MS[f.range]
    if (p.issuedAt.toMillis() < from) return false
  }
  const n = f.needle.trim().toLowerCase()
  if (n === '') return true
  return [p.visitorName, p.visitorOrganization ?? '', p.hostName ?? '', p.purposeOfVisit, p.passCode].some((v) => v.toLowerCase().includes(n.replace(/[\s-]+/g, '').length === 8 ? n.replace(/[\s-]+/g, '') : n))
}
