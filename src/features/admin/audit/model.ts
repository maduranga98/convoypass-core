import { strings } from '@/lib/strings'
import type { CellValue, ReportColumn, ReportRow } from '@/types/reports'

export const PAGE_SIZE = 25
/** Raw documents read per round trip when a client-side filter has to skim past non-matching rows. */
export const BATCH = 50
/** The CSV export stops here (and says so). */
export const EXPORT_CAP = 5000

export type Meta = Record<string, string | number | boolean | null>

export interface AuditEntry {
  id: string
  action: string
  actorUid: string
  actorRole: string
  /** Display name of a non-tenant actor (`ConvoyPass Super Admin`). */
  actorName?: string
  targetType: string
  targetId: string
  meta: Meta
  /** Epoch ms. */
  createdAt: number
}

export interface AuditFilters {
  /** `YYYY-MM-DD` in the tenant timezone, inclusive. */
  from: string
  to: string
  actor: string
  action: string
  target: string
}

/**
 * One server-side filter (the three indexes are tenant + one of actor/action/target + createdAt); the others are
 * applied to the rows as they arrive, so any combination works without more indexes.
 */
export function serverFilter(f: AuditFilters): { field: 'actorUid' | 'action' | 'targetType'; value: string } | null {
  if (f.actor) return { field: 'actorUid', value: f.actor }
  if (f.action) return { field: 'action', value: f.action }
  if (f.target) return { field: 'targetType', value: f.target }
  return null
}

export const matches = (f: AuditFilters) => (e: AuditEntry): boolean =>
  (!f.actor || e.actorUid === f.actor) && (!f.action || e.action === f.action) && (!f.target || e.targetType === f.target)

export const KNOWN_ACTIONS = Object.keys(strings.audit.actions) as (keyof typeof strings.audit.actions)[]
export const TARGET_TYPES = Object.keys(strings.audit.targets) as (keyof typeof strings.audit.targets)[]

export const actionLabel = (action: string): string => (strings.audit.actions as Record<string, string>)[action] ?? action
export const targetLabel = (type: string): string => (strings.audit.targets as Record<string, string>)[type] ?? type

interface Stamp {
  toMillis: () => number
}
const isStamp = (v: unknown): v is Stamp => typeof v === 'object' && v !== null && typeof (v as Stamp).toMillis === 'function'

/** Stored document -> view model. Only scalar meta values are kept. */
export function toAuditEntry(id: string, data: Record<string, unknown>): AuditEntry {
  const meta: Meta = {}
  if (typeof data.meta === 'object' && data.meta !== null) {
    for (const [k, v] of Object.entries(data.meta)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) meta[k] = v
    }
  }
  return {
    id,
    action: String(data.action ?? ''),
    actorUid: String(data.actorUid ?? ''),
    actorRole: String(data.actorRole ?? ''),
    ...(typeof data.actorName === 'string' ? { actorName: data.actorName } : {}),
    targetType: String(data.targetType ?? ''),
    targetId: String(data.targetId ?? ''),
    meta,
    createdAt: isStamp(data.createdAt) ? data.createdAt.toMillis() : 0,
  }
}

const trueKeys = (meta: Meta): string[] => Object.entries(meta).filter(([, v]) => v === true).map(([k]) => k)

/** One short line for the table. The drawer shows everything. */
export function summarise(e: Pick<AuditEntry, 'action' | 'targetType' | 'meta'>): string {
  const m = e.meta
  switch (e.action) {
    case 'user.create':
      return [m.role && `Role: ${String(m.role)}`].filter(Boolean).join('') || 'New account'
    case 'user.update': {
      const changed = trueKeys(m)
      return changed.length > 0 ? `Changed: ${changed.join(', ')}` : 'Profile changed'
    }
    case 'vehicle.import':
      return `${String(m.created ?? 0)} created, ${String(m.failed ?? 0)} failed, ${String(m.rows ?? 0)} rows`
    case 'vehicle.update': {
      const changed = trueKeys(m)
      return changed.length > 0 ? `Changed: ${changed.join(', ')}` : 'Vehicle changed'
    }
    case 'vehicle.setDrivers':
      return `${String(m.count ?? 0)} drivers assigned`
    case 'tenant.settings.update': {
      const touched = Object.entries(m).filter(([, v]) => v === true || (typeof v === 'number' && v !== 0)).map(([k]) => k)
      return touched.length > 0 ? `Changed: ${touched.join(', ')}` : 'Settings saved'
    }
    case 'evidence.purge':
      return `${String(m.passes ?? 0)} passes, ${String(m.files ?? 0)} photos removed`
    default: {
      const bits = Object.entries(m)
        .filter(([, v]) => v !== null && v !== false)
        .slice(0, 3)
        .map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`))
      return bits.join(' · ')
    }
  }
}

/**
 * Collects up to `size` entries that pass `keep`, reading raw batches until the page is full or the log runs out.
 * `cursor` is the last raw document consumed, so the next page starts right after the last entry shown.
 */
export async function fillPage<Cursor>(
  fetchBatch: (after: Cursor | null) => Promise<{ entries: { entry: AuditEntry; cursor: Cursor }[]; exhausted: boolean }>,
  keep: (e: AuditEntry) => boolean,
  size: number,
  start: Cursor | null,
  maxBatches = 20,
): Promise<{ entries: AuditEntry[]; cursor: Cursor | null; more: boolean }> {
  const out: AuditEntry[] = []
  let after = start
  let cursor = start
  for (let i = 0; i < maxBatches; i++) {
    const batch = await fetchBatch(after)
    for (const [index, { entry, cursor: c }] of batch.entries.entries()) {
      if (!keep(entry)) continue
      out.push(entry)
      cursor = c
      if (out.length === size) {
        const rest = batch.entries.length - index - 1
        return { entries: out, cursor, more: rest > 0 || !batch.exhausted }
      }
    }
    const last = batch.entries.at(-1)
    if (last) {
      after = last.cursor
      cursor = last.cursor
    }
    if (batch.exhausted) return { entries: out, cursor, more: false }
  }
  // Skimmed a long stretch without filling the page: stop here, there may be more further back.
  return { entries: out, cursor, more: true }
}

export const AUDIT_COLUMNS: ReportColumn[] = [
  { key: 'time', label: strings.audit.time, type: 'datetime' },
  { key: 'actor', label: strings.audit.actor, type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
  { key: 'action', label: strings.audit.action, type: 'text' },
  { key: 'actionCode', label: 'Action code', type: 'text' },
  { key: 'targetType', label: strings.audit.targetType, type: 'text' },
  { key: 'target', label: strings.audit.target, type: 'text' },
  { key: 'summary', label: strings.audit.summary, type: 'text' },
  { key: 'meta', label: strings.audit.meta, type: 'text' },
]

/** Entries -> report rows for the shared CSV writer (which neutralises formulas in every text cell). */
export function toExportRows(entries: readonly AuditEntry[], actorName: (uid: string) => string): ReportRow[] {
  return entries.map((e): Record<string, CellValue> => ({
    time: e.createdAt,
    actor: actorName(e.actorUid),
    role: e.actorRole,
    action: actionLabel(e.action),
    actionCode: e.action,
    targetType: targetLabel(e.targetType),
    target: e.targetId,
    summary: summarise(e),
    meta: JSON.stringify(e.meta),
  }))
}
