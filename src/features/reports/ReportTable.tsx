import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { ReportColumn, ReportRow } from '@/types/reports'
import { formatCell } from './exports/format'
import { pageCount, type Sort } from './sort'

const t = strings.reports.table

/** Free text that may be long: it wraps when printed, every other column stays on one line. */
const LONG_TEXT = new Set(['note', 'reason', 'rejections', 'offline'])

const align = (c: ReportColumn): string =>
  c.type === 'number' || c.type === 'percent' || c.type === 'minutes'
    ? 'whitespace-nowrap text-right tabular-nums'
    : c.type === 'datetime' || c.type === 'date'
      ? 'whitespace-nowrap text-left'
      : LONG_TEXT.has(c.key)
        ? 'text-left print:max-w-[26rem]'
        : 'text-left print:whitespace-nowrap'

/** A plain table (no sorting): summary breakdowns and the table version of a chart. */
export function SimpleTable({ columns, rows, timeZone, caption }: { columns: ReportColumn[]; rows: ReportRow[]; timeZone: string; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn('px-3 py-2', align(c))}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className={row.isTotal ? 'font-semibold' : ''}>
              {columns.map((c) => <td key={c.key} className={cn('px-3 py-2', align(c))}>{formatCell(row[c.key], c, timeZone)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The report data: sortable columns (`aria-sort`), 50 rows a page, a pinned totals row. When `all` is set (printing)
 * every row is rendered so the printed report is complete, with the header repeating on each page.
 */
export function ReportTable({ columns, rows, totals, total, page, sort, onSort, onPage, timeZone, caption, all }: {
  columns: ReportColumn[]
  /** The rows of the current page (or all of them when printing). */
  rows: ReportRow[]
  totals: ReportRow[]
  /** Data rows overall (without the totals row). */
  total: number
  page: number
  sort: Sort | null
  onSort: (key: string) => void
  onPage: (page: number) => void
  timeZone: string
  caption: string
  all: boolean
}) {
  const pages = pageCount(total)
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface print:overflow-visible print:rounded-none print:border-0">
        <table className="report-table w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('whitespace-nowrap px-3 py-2', align(c))}>
                    {all ? (
                      // While printing the header is plain text: it repeats on every page.
                      c.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        aria-label={t.sortBy(c.label)}
                        className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {c.label}
                        <span aria-hidden>
                          {active ? (sort?.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 text-slate-500" />}
                        </span>
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="print:break-inside-avoid">
                {columns.map((c) => <td key={c.key} className={cn('px-3 py-2 align-top', align(c))}>{formatCell(row[c.key], c, timeZone)}</td>)}
              </tr>
            ))}
          </tbody>
          {totals.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 font-semibold">
              {totals.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => <td key={c.key} className={cn('px-3 py-2', align(c))}>{formatCell(row[c.key], c, timeZone)}</td>)}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      {!all && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 print:hidden">
          <p role="status">{t.rows(total)}</p>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t.previous}</Button>
              <span>{t.page(page, pages)}</span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t.next}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
