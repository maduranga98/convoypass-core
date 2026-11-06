import { sanitiseMeta } from './core.js'
import { dateKey, DEFAULT_TIMEZONE } from './dates.js'
import { logError, logInfo } from './logger.js'
import type { AuditEntry, PassData, TenantData } from './types.js'

/** Per tenant and run. The backlog (when retention is first switched on) clears over several nights. */
export const PURGE_MAX_PASSES_PER_RUN = 200

export interface RetentionPort {
  listTenants(): Promise<{ id: string; data: TenantData & { retentionCursor?: string } }[]>
  /** Passes of the tenant with `after < dateKey < before`, oldest first, at most `limit`. */
  listPassesBetween(q: { tenantId: string; afterKey: string | null; beforeKey: string; limit: number }): Promise<{ id: string; pass: PassData }[]>
  /** Deletes every object under tenants/{tenantId}/passes/{vehicleId}/{dateKey}/ (all attempts). Returns how many. */
  deleteEvidence(tenantId: string, vehicleId: string, dateKey: string): Promise<number>
  /** Sets `evidenceDeletedAt` (server time) on the pass. The pass document, its history and decisions stay. */
  markEvidenceDeleted(passId: string): Promise<void>
  /** Remembers how far the purge got, so finished days are never listed again. */
  setCursor(tenantId: string, key: string): Promise<void>
  writeAudit(entry: AuditEntry): Promise<void>
}

export interface PurgeSummary {
  tenants: number
  passes: number
  files: number
  failed: number
}

const previousDay = (key: string): string => {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) - 1))
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

/** The first day (YYYYMMDD) that is still kept: passes with an older dateKey are past the retention limit. */
export const cutoffKey = (timezone: string, retentionDays: number, nowMs: number): string =>
  dateKey(timezone, new Date(nowMs - retentionDays * 86_400_000))

/**
 * Daily job. Does nothing for tenants with `retentionDays` 0 or unset (the default). Otherwise removes the Storage
 * evidence of passes older than the cutoff, stamps `evidenceDeletedAt` and writes one audit entry per tenant and run.
 * Pass documents and history are kept. Safe to re-run: stamped passes are skipped and the cursor only moves forward.
 */
export async function purgeOldEvidence(port: RetentionPort, nowMs: number): Promise<PurgeSummary> {
  const summary: PurgeSummary = { tenants: 0, passes: 0, files: 0, failed: 0 }
  for (const tenant of await port.listTenants()) {
    const days = tenant.data.retentionDays ?? 0
    if (!Number.isInteger(days) || days < 30) continue // 0 = keep forever; anything below the minimum is ignored, not honoured
    summary.tenants++
    const before = cutoffKey(tenant.data.timezone ?? DEFAULT_TIMEZONE, days, nowMs)
    const candidates = await port.listPassesBetween({
      tenantId: tenant.id,
      afterKey: tenant.data.retentionCursor ?? null,
      beforeKey: before,
      limit: PURGE_MAX_PASSES_PER_RUN,
    })
    let passes = 0
    let files = 0
    let lastKey: string | null = null
    for (const { id, pass } of candidates) {
      if (pass.tenantId !== tenant.id || pass.dateKey >= before) continue
      if (pass.evidenceDeletedAt) {
        lastKey = pass.dateKey
        continue
      }
      try {
        files += await port.deleteEvidence(tenant.id, pass.vehicleId, pass.dateKey)
        await port.markEvidenceDeleted(id)
        passes++
        lastKey = pass.dateKey
      } catch (e) {
        summary.failed++
        logError({ fn: 'purgeOldEvidence', tenantId: tenant.id }, e, { step: 'purge-pass' })
        break // keep order: the cursor must not skip a pass that failed
      }
    }
    if (passes > 0) {
      await port.writeAudit({
        tenantId: tenant.id,
        action: 'evidence.purge',
        actorUid: 'system',
        actorRole: 'system',
        targetType: 'tenant',
        targetId: tenant.id,
        meta: sanitiseMeta({ passes, files, retentionDays: days, before }),
      })
    }
    // A full batch may end in the middle of a day: step back one day so the rest of it is looked at next run.
    if (lastKey) await port.setCursor(tenant.id, candidates.length >= PURGE_MAX_PASSES_PER_RUN ? previousDay(lastKey) : lastKey)
    summary.passes += passes
    summary.files += files
  }
  logInfo({ fn: 'purgeOldEvidence' }, 'ok', { ...summary })
  return summary
}
