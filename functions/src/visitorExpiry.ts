// Scheduled housekeeping for visitor passes: expire `active` passes past `validUntil`, and flag (never close) checked-in
// passes that stayed inside past their own `maxDwellMinutes`. The flag is what supervisors see, exactly as the overdue
// vehicle visits (`dwellWarning`); a check-out is never blocked. Idempotent: a second run changes nothing.
import { logError, logInfo } from './logger.js'
import { isOverstay } from './visitorLogic.js'
import type { VisitorPort } from './visitors.js'

/** Passes handled per tenant per run (a backlog is picked up by the next run). */
export const VISITOR_BATCH = 200

export interface VisitorExpirySummary {
  tenants: number
  expired: number
  flagged: number
  failedTenants: number
}

export async function expireVisitorPasses(port: VisitorPort, nowMs: number): Promise<VisitorExpirySummary> {
  const summary: VisitorExpirySummary = { tenants: 0, expired: 0, flagged: 0, failedTenants: 0 }
  for (const tenant of await port.listTenants()) {
    summary.tenants++
    try {
      const expiredIds = await port.listExpired(tenant.id, nowMs, VISITOR_BATCH)
      if (expiredIds.length > 0) summary.expired += await port.expireTx(tenant.id, expiredIds, nowMs)
      const over = (await port.listUnflaggedInside(tenant.id, VISITOR_BATCH * 2)).filter((p) => isOverstay(p, nowMs)).map((p) => p.id)
      if (over.length > 0) summary.flagged += await port.flagTx(tenant.id, over.slice(0, VISITOR_BATCH), nowMs)
    } catch (e) {
      summary.failedTenants++
      logError({ fn: 'expireVisitorPasses', tenantId: tenant.id }, e)
    }
  }
  logInfo({ fn: 'expireVisitorPasses' }, 'ok', { ...summary })
  return summary
}
