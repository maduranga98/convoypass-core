import { collection, getDocs, limit, orderBy, query, startAfter, Timestamp, where, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { BATCH, EXPORT_CAP, fillPage, matches, serverFilter, toAuditEntry, type AuditEntry, type AuditFilters } from './model'
import { rangeMs } from './range'

export type Cursor = QueryDocumentSnapshot

export function buildConstraints(tenantId: string, f: AuditFilters, timeZone: string, after: Cursor | null): QueryConstraint[] {
  const { startMs, endMs } = rangeMs(f.from, f.to, timeZone)
  const primary = serverFilter(f)
  return [
    // The rules require the tenant on every query.
    where('tenantId', '==', tenantId),
    ...(primary ? [where(primary.field, '==', primary.value)] : []),
    where('createdAt', '>=', Timestamp.fromMillis(startMs)),
    where('createdAt', '<', Timestamp.fromMillis(endMs)),
    orderBy('createdAt', 'desc'),
    ...(after ? [startAfter(after)] : []),
    limit(BATCH),
  ]
}

export async function fetchAuditPage(tenantId: string, f: AuditFilters, timeZone: string, after: Cursor | null, size: number) {
  return fillPage<Cursor>(
    async (cursor) => {
      const snap = await getDocs(query(collection(db, 'auditLog'), ...buildConstraints(tenantId, f, timeZone, cursor)))
      return {
        entries: snap.docs.map((d) => ({ entry: toAuditEntry(d.id, d.data()), cursor: d })),
        exhausted: snap.docs.length < BATCH,
      }
    },
    matches(f),
    size,
    after,
  )
}

/** Everything matching the filters, newest first, up to the export cap. */
export async function fetchAuditForExport(tenantId: string, f: AuditFilters, timeZone: string): Promise<{ entries: AuditEntry[]; capped: boolean }> {
  const entries: AuditEntry[] = []
  let cursor: Cursor | null = null
  for (;;) {
    const page = await fetchAuditPage(tenantId, f, timeZone, cursor, Math.min(BATCH, EXPORT_CAP - entries.length))
    entries.push(...page.entries)
    cursor = page.cursor
    if (entries.length >= EXPORT_CAP) return { entries, capped: page.more }
    if (!page.more || !cursor) return { entries, capped: false }
  }
}
