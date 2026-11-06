import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Title line of the mobile card. */
  primary?: boolean
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  actions?: (row: T) => ReactNode
  caption: string
}

/** Table from `md` up, stacked cards below. */
export function DataTable<T>({ columns, rows, rowKey, actions, caption }: DataTableProps<T>) {
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const secondary = columns.filter((c) => c !== primary)

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3', c.className)}>
                  {c.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">{strings.common.actions}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50/60">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle text-slate-700', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && <td className="px-4 py-2 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
            <div className="font-medium text-ink">{primary?.cell(row)}</div>
            <dl className="space-y-1.5 text-sm">
              {secondary.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">{c.header}</dt>
                  <dd className="text-right text-slate-700">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="-mx-1 flex justify-end border-t border-slate-100 pt-2">{actions(row)}</div>}
          </li>
        ))}
      </ul>
    </>
  )
}
