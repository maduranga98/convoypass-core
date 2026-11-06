import type { CellValue, ReportColumn, ReportRow } from '@/types/reports'

export const PAGE_SIZE = 50

export interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

const isTotal = (r: ReportRow): boolean => r.isTotal === true

function compare(a: CellValue | undefined, b: CellValue | undefined): number {
  const aNull = a === null || a === undefined || a === ''
  const bNull = b === null || b === undefined || b === ''
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Sorted copy (stable). Empty cells go last in both directions; the totals row stays pinned at the end. */
export function sortRows(rows: readonly ReportRow[], columns: readonly ReportColumn[], sort: Sort | null): ReportRow[] {
  const body = rows.filter((r) => !isTotal(r))
  const totals = rows.filter(isTotal)
  const known = sort ? columns.some((c) => c.key === sort.key) : false
  if (!sort || !known) return [...body, ...totals]
  const sign = sort.dir === 'asc' ? 1 : -1
  const sorted = body
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const xv = x.row[sort.key]
      const yv = y.row[sort.key]
      const xEmpty = xv === null || xv === undefined || xv === ''
      const yEmpty = yv === null || yv === undefined || yv === ''
      if (xEmpty || yEmpty) return compare(xv, yv) || x.index - y.index
      return compare(xv, yv) * sign || x.index - y.index
    })
    .map((x) => x.row)
  return [...sorted, ...totals]
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

/** One page of the data rows (the totals row is shown separately, on every page). */
export function pageOf(rows: readonly ReportRow[], page: number): ReportRow[] {
  const body = rows.filter((r) => !isTotal(r))
  return body.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
}
