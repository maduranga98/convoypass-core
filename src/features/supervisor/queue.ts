import { toMs } from '@/features/passes/passView'
import type { PassDoc, PassStatus } from '@/types/passes'

export type SupervisorTab = 'pending' | 'approved' | 'rejected'

/** What each Approvals tab lists. Home reads the same lists, so both share one listener per tab. */
export const TAB_STATUSES: Record<SupervisorTab, PassStatus[]> = {
  pending: ['submitted'],
  // Passes this supervisor approved today stay listed while they move on to the officer and the gate.
  approved: ['supervisor_approved', 'officer_approved', 'checked_in'],
  rejected: ['rejected'],
}

type Submitted = Pick<PassDoc, 'submittedAt'>

/** Longest waiting first: the order a supervisor should work through. A pending server time sorts last. */
export const oldestFirst = <T extends Submitted>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (toMs(a.submittedAt) ?? Infinity) - (toMs(b.submittedAt) ?? Infinity))

/** Waited longer than the tenant's supervisor time target (the clock the SLA reminder uses too). */
export function isOverdue(pass: Submitted, now: number, targetMinutes: number): boolean {
  const ms = toMs(pass.submittedAt)
  return ms !== null && now - ms > targetMinutes * 60_000
}

/** The pass after `currentId` in queue order, wrapping round; `null` when nothing else is waiting. */
export function nextInQueue(ids: readonly string[], currentId: string): string | null {
  const others = ids.filter((id) => id !== currentId)
  if (others.length === 0) return null
  const at = ids.indexOf(currentId)
  return at < 0 ? (others[0] ?? null) : (ids.slice(at + 1).find((id) => id !== currentId) ?? others[0] ?? null)
}

