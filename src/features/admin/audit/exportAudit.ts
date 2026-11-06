import { csvBlob, toCsv } from '@/features/reports/exports/csv'
import { download } from '@/features/reports/exports/download'
import { AUDIT_COLUMNS, toExportRows, type AuditEntry, type AuditFilters } from './model'

export const auditFileName = (f: Pick<AuditFilters, 'from' | 'to'>): string => `convoypass_audit_${f.from}_${f.to}.csv`

/** The Module 6 CSV writer: UTF-8 with BOM, CRLF, RFC 4180 quoting, formula-injection protection on every text cell. */
export function auditCsv(entries: readonly AuditEntry[], actorName: (uid: string) => string, timeZone: string): string {
  return toCsv(AUDIT_COLUMNS, toExportRows(entries, actorName), timeZone)
}

export function downloadAuditCsv(entries: readonly AuditEntry[], f: AuditFilters, actorName: (uid: string) => string, timeZone: string): void {
  download(csvBlob(auditCsv(entries, actorName, timeZone)), auditFileName(f))
}
