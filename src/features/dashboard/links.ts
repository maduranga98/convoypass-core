import type { Kpis } from './model'

export type DashboardScope = 'admin' | 'officer'

/** `20260310` -> `2026-03-10`. */
export const toDay = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

/** Where a report for exactly today lives for this role. */
export const reportLink = (scope: DashboardScope, type: string, today: string | null): string =>
  `/${scope}/reports?type=${type}${today ? `&from=${toDay(today)}&to=${toDay(today)}` : ''}`

/**
 * The list each tile opens. Admin: the passes page filtered by status. Officer: their queue tab, or a report for
 * the figures that have no queue (their queue only holds what they decide on).
 */
export function kpiLink(scope: DashboardScope, key: keyof Kpis, today: string | null): string | null {
  if (scope === 'admin') {
    const status: Record<keyof Kpis, string> = {
      submitted: '',
      waitingSupervisor: 'submitted',
      waitingOfficer: 'supervisor_approved',
      approved: 'officer_approved',
      checkedIn: 'checked_in',
      rejected: 'rejected',
    }
    return status[key] ? `/admin/passes?status=${status[key]}` : '/admin/passes'
  }
  switch (key) {
    case 'waitingOfficer':
      return '/officer'
    case 'approved':
      return '/officer?tab=approved'
    case 'rejected':
      return '/officer?tab=rejected'
    case 'submitted':
      return reportLink('officer', 'contractor_activity', today)
    case 'checkedIn':
      return reportLink('officer', 'gate_log', today)
    default:
      return null
  }
}

/** The page that shows one pass. An officer can only open passes that wait for them. */
export function passLink(scope: DashboardScope, passId: string, status: string): string | null {
  if (scope === 'admin') return `/admin/passes?pass=${encodeURIComponent(passId)}`
  return status === 'supervisor_approved' ? `/officer?pass=${encodeURIComponent(passId)}` : null
}
