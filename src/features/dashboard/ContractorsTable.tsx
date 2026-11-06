import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import type { ContractorRow } from './model'

const t = strings.dashboard.contractors

export function ContractorsTable({ rows, loading }: { rows: ContractorRow[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />
  return (
    <section aria-labelledby="contractors-title" className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
      <h2 id="contractors-title" className="text-base font-semibold">{t.title}</h2>
      {rows.length === 0 ? (
        <div className="py-6 text-center">
          <p className="font-medium text-ink">{t.empty}</p>
          <p className="text-sm text-slate-500">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t.title}</caption>
            <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3">{t.columns.contractor}</th>
                {(['submitted', 'waiting', 'approved', 'checkedIn', 'rejected'] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-right">{t.columns[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {rows.map((r) => (
                <tr key={r.contractorId}>
                  <th scope="row" className="py-2 pr-3 font-medium">{r.name}</th>
                  <td className="px-3 py-2 text-right">{r.submitted}</td>
                  <td className={`px-3 py-2 text-right ${r.waiting > 0 ? 'font-semibold text-warning-ink' : ''}`}>{r.waiting}</td>
                  <td className="px-3 py-2 text-right">{r.approved}</td>
                  <td className="px-3 py-2 text-right">{r.checkedIn}</td>
                  <td className="px-3 py-2 text-right">{r.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
