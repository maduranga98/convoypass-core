// Pure helpers for scripts/verify-restore.ts (tested without any database).
export const COLLECTIONS = [
  'tenants', 'users', 'contractors', 'vehicles', 'drivers', 'vehiclePlates', 'passes', 'gateEvents', 'auditLog', 'notifications',
] as const

export type Counts = Record<string, number>

export interface Comparison {
  rows: { collection: string; expected: number; actual: number; diff: number; ok: boolean }[]
  ok: boolean
}

/** Compares document counts per collection. `tolerance` is how many documents a collection may differ by (writes since the snapshot). */
export function compareCounts(expected: Counts, actual: Counts, tolerance = 0): Comparison {
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort((a, b) => COLLECTIONS.indexOf(a as never) - COLLECTIONS.indexOf(b as never) || a.localeCompare(b))
  const rows = names.map((collection) => {
    const e = expected[collection] ?? 0
    const a = actual[collection] ?? 0
    return { collection, expected: e, actual: a, diff: a - e, ok: Math.abs(a - e) <= tolerance }
  })
  return { rows, ok: rows.every((r) => r.ok) }
}

export function formatComparison(c: Comparison): string {
  const w = Math.max(10, ...c.rows.map((r) => r.collection.length))
  const lines = [`${'collection'.padEnd(w)}  expected  restored      diff`]
  for (const r of c.rows) {
    lines.push(`${r.collection.padEnd(w)}  ${String(r.expected).padStart(8)}  ${String(r.actual).padStart(8)}  ${String(r.diff >= 0 ? `+${r.diff}` : r.diff).padStart(8)}  ${r.ok ? 'ok' : 'MISMATCH'}`)
  }
  return lines.join('\n')
}
