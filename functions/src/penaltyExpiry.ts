// Scheduled auto-expiry of fixed-duration penalties. The live eligibility check already ignores a penalty whose last day
// has passed (`isBlocking`), so this job only keeps the stored `status` honest for lists, history and counts.
import { sanitiseMeta } from './auditMeta.js'
import { logError, logInfo } from './logger.js'
import { shouldExpire } from './penaltyLogic.js'
import type { AuditEntry, PenaltyData } from './types.js'

/** Penalties read per page; one transaction (<= 500 writes: a patch and an audit entry each) per page. */
export const EXPIRY_PAGE_SIZE = 200

export interface PenaltyExpiryPort {
  /** Active fixed penalties whose end date is before `nowMs`, oldest first, at most `limit`. */
  listDue(nowMs: number, limit: number): Promise<{ id: string; data: PenaltyData }[]>
  /**
   * One transaction: re-reads each penalty and, only when it is still due (not revoked or changed meanwhile), sets
   * `status: expired` + `expiredAt` and writes a `system` audit entry. Returns how many were expired.
   */
  expire(ids: string[], nowMs: number): Promise<number>
}

export interface PenaltyExpirySummary {
  due: number
  expired: number
  failedPages: number
}

/** The system audit entry for one expiry (`actorRole: 'system'`, like the other scheduled jobs). */
export const expiryAudit = (p: PenaltyData, penaltyId: string): AuditEntry => ({
  tenantId: p.tenantId,
  action: 'penalty.expire',
  actorUid: 'system',
  actorRole: 'system',
  targetType: 'penalty',
  targetId: penaltyId,
  meta: sanitiseMeta({ typeId: p.typeId }),
})

export const isDue = (p: PenaltyData, nowMs: number): boolean => shouldExpire(p, nowMs)

/**
 * Flips active fixed penalties past their end date to `expired`. Idempotent (a run with nothing due writes nothing) and
 * bounded: a page that fails is logged and the next run picks it up again.
 */
export async function expirePenalties(port: PenaltyExpiryPort, nowMs: number, maxPages = 25): Promise<PenaltyExpirySummary> {
  const summary: PenaltyExpirySummary = { due: 0, expired: 0, failedPages: 0 }
  for (let page = 0; page < maxPages; page++) {
    const due = await port.listDue(nowMs, EXPIRY_PAGE_SIZE)
    if (due.length === 0) break
    summary.due += due.length
    try {
      const n = await port.expire(due.map((d) => d.id), nowMs)
      summary.expired += n
      if (n === 0) break // nothing moved (all raced): avoid reading the same page again
    } catch (e) {
      summary.failedPages++
      logError({ fn: 'expirePenalties' }, e, { step: 'page' })
      break
    }
    if (due.length < EXPIRY_PAGE_SIZE) break
  }
  logInfo({ fn: 'expirePenalties' }, 'ok', { ...summary })
  return summary
}
