import { describe, expect, it } from 'vitest'
import type { ReportColumn, ReportRow } from '@/types/reports'
import { pageCount, pageOf, PAGE_SIZE, sortRows } from './sort'

const columns: ReportColumn[] = [{ key: 'name', label: 'Name', type: 'text' }, { key: 'n', label: 'N', type: 'number' }]
const rows: ReportRow[] = [
  { name: 'b', n: 2 }, { name: 'a', n: null }, { name: 'c', n: 10 }, { name: 'Total', n: 12, isTotal: true },
]

describe('sortRows', () => {
  it('sorts numbers and text, empty cells last in both directions, totals row pinned', () => {
    expect(sortRows(rows, columns, { key: 'n', dir: 'asc' }).map((r) => r.name)).toEqual(['b', 'c', 'a', 'Total'])
    expect(sortRows(rows, columns, { key: 'n', dir: 'desc' }).map((r) => r.name)).toEqual(['c', 'b', 'a', 'Total'])
    expect(sortRows(rows, columns, { key: 'name', dir: 'desc' }).map((r) => r.name)).toEqual(['c', 'b', 'a', 'Total'])
  })
  it('keeps the original order without a sort, and does not mutate', () => {
    const copy = [...rows]
    expect(sortRows(rows, columns, null).map((r) => r.name)).toEqual(['b', 'a', 'c', 'Total'])
    expect(rows).toEqual(copy)
  })
})

describe('paging', () => {
  it('50 rows per page, totals excluded from the count', () => {
    const many: ReportRow[] = Array.from({ length: 120 }, (_, i) => ({ name: `r${i}`, n: i }))
    many.push({ name: 'Total', n: 0, isTotal: true })
    expect(PAGE_SIZE).toBe(50)
    expect(pageCount(120)).toBe(3)
    expect(pageCount(0)).toBe(1)
    expect(pageOf(many, 1)).toHaveLength(50)
    expect(pageOf(many, 3)).toHaveLength(20)
    expect(pageOf(many, 3).some((r) => r.isTotal)).toBe(false)
  })
})
