// Scheduled dwell warning: a visit still checked in after the company's dwell limit (default 16 h, `tenants.dwellLimitHours`)
// gets `dwellWarning: true`. WARNING ONLY: nothing is blocked, and no other action reads the flag. What happens at the limit
// (auto-flag only / hard block / admin alert) and whether it runs from check-in is an open client decision.
import { logError, logInfo } from './logger.js'
import { dwellLimitHoursOf } from './visitLogic.js'
import type { AuditEntry, TenantData } from './types.js'

/** Visits flagged per tenant per run (a backlog is picked up by the next run). */
export const DWELL_BATCH = 200

export interface DwellPort {
  listTenants(): Promise<{ id: string; data: TenantData }[]>
  /** Visits of the tenant still checked in, not yet flagged, checked in at or before `cutoffMs`, oldest first. */
  listOverdue(tenantId: string, cutoffMs: number, limit: number): Promise<string[]>
  /**
   * One transaction: re-reads each visit and flags only those still checked in, unflagged and past the cutoff
   * (a check-out in between wins). Writes one `system` audit entry each. Returns how many were flagged.
   */
  flag(tenantId: string, ids: string[], cutoffMs: number, nowMs: number): Promise<number>
}

export interface DwellSummary {
  tenants: number
  flagged: number
  failedTenants: number
}

export const dwellAudit = (tenantId: string, visitId: string, limitHours: number): AuditEntry => ({
  tenantId,
  action: 'visit.dwellWarning',
  actorUid: 'system',
  actorRole: 'system',
  targetType: 'visit',
  targetId: visitId,
  meta: { limitHours },
})

/** Idempotent: a second run flags nothing new. A tenant that fails is logged and retried by the next run. */
export async function flagDwellVisits(port: DwellPort, nowMs: number): Promise<DwellSummary> {
  const summary: DwellSummary = { tenants: 0, flagged: 0, failedTenants: 0 }
  for (const tenant of await port.listTenants()) {
    summary.tenants++
    try {
      const limitHours = dwellLimitHoursOf(tenant.data)
      const cutoff = nowMs - limitHours * 3_600_000
      const ids = await port.listOverdue(tenant.id, cutoff, DWELL_BATCH)
      if (ids.length > 0) summary.flagged += await port.flag(tenant.id, ids, cutoff, nowMs)
    } catch (e) {
      summary.failedTenants++
      logError({ fn: 'flagDwellVisits', tenantId: tenant.id }, e)
    }
  }
  logInfo({ fn: 'flagDwellVisits' }, 'ok', { ...summary })
  return summary
}
