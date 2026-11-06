import type { PassStatus, PassWithId } from '@/types/passes'

/** Statuses that mean a supervisor let the vehicle through ("in"): approved by the supervisor, or further along. */
export const APPROVED_STATUSES: readonly PassStatus[] = ['supervisor_approved', 'officer_approved', 'checked_in']

export interface DailyCounts {
  /** Vehicles with a pass on the day. */
  total: number
  /** Vehicles approved (in). */
  approved: number
  /** Vehicles rejected (supervisor, officer or revoked). */
  rejected: number
  /** Still waiting for the supervisor. */
  waiting: number
  /** Of the rejected ones: rejected at the supervisor step. */
  rejectedBySupervisor: number
}

/** One pass per vehicle per day, so counting passes counts vehicles. */
export function dailyCounts(passes: readonly Pick<PassWithId, 'status' | 'rejection'>[]): DailyCounts {
  const out: DailyCounts = { total: passes.length, approved: 0, rejected: 0, waiting: 0, rejectedBySupervisor: 0 }
  for (const p of passes) {
    if (p.status === 'rejected') {
      out.rejected++
      if (p.rejection?.stage === 'supervisor') out.rejectedBySupervisor++
    } else if (p.status === 'submitted') out.waiting++
    else if (APPROVED_STATUSES.includes(p.status)) out.approved++
  }
  return out
}

/** `YYYY-MM-DD` (date input) <-> `YYYYMMDD` (pass dateKey). */
export const keyFromInput = (v: string): string => v.replaceAll('-', '')
export const inputFromKey = (k: string): string => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`
