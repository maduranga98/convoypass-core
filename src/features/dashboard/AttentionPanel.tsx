import { CircleCheck, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatTime, toMs } from '@/features/passes/passView'
import { strings } from '@/lib/strings'
import { passLink, reportLink, type DashboardScope } from './links'
import type { AttentionItem } from './model'

const t = strings.dashboard.attention

const minutes = (ms: number): string => {
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Passes past their time target (oldest first) and today's denied entries. */
export function AttentionPanel({ items, denied, loading, scope, today, contractorName }: {
  items: AttentionItem[]
  denied: number
  loading: boolean
  scope: DashboardScope
  today: string | null
  contractorName: (id: string) => string
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />
  const clear = items.length === 0 && denied === 0
  return (
    <section aria-labelledby="attention-title" className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
      <h2 id="attention-title" className="flex items-center gap-2 text-base font-semibold">
        {clear ? <CircleCheck aria-hidden className="size-5 text-success" /> : <TriangleAlert aria-hidden className="size-5 text-warning" />}
        {t.title}
      </h2>
      {clear ? (
        <div>
          <p className="font-medium text-ink">{t.nothing}</p>
          <p className="text-sm text-slate-500">{t.nothingHint}</p>
        </div>
      ) : (
        <>
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t.overdue}</caption>
                <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 pr-3">{t.columns.age}</th>
                    <th scope="col" className="px-3 py-2">{t.columns.contractor}</th>
                    <th scope="col" className="px-3 py-2">{t.columns.plate}</th>
                    <th scope="col" className="px-3 py-2">{t.columns.holder}</th>
                    <th scope="col" className="py-2 pl-3"><span className="sr-only">{t.open}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => {
                    const href = passLink(scope, i.pass.id, i.pass.status)
                    const name = contractorName(i.pass.contractorId)
                    return (
                      <tr key={i.pass.id}>
                        <td className="py-2 pr-3 tabular-nums">
                          <span className="font-medium text-warning-ink">{minutes(i.waitedMs)}</span>
                          <span className="block text-xs text-slate-500">{t.overBy(Math.floor(i.overMs / 60_000))} · {formatTime(toMs(i.holder === 'supervisor' ? i.pass.submittedAt : i.pass.supervisor?.at))}</span>
                        </td>
                        <td className="px-3 py-2">{name}</td>
                        <td className="px-3 py-2 font-medium">{i.pass.plateNo}</td>
                        <td className="px-3 py-2 text-slate-600">{i.holder === 'supervisor' ? t.supervisorsOf(name) : t.officers}</td>
                        <td className="py-2 pl-3 text-right">
                          {href && <Link to={href} aria-label={`${t.open} ${i.pass.plateNo}`} className="font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus">{t.open}</Link>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {denied > 0 && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium">{t.deniedToday(denied)}</span>
              <Link to={reportLink(scope, 'gate_log', today)} className="font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus">{t.viewDenied}</Link>
            </p>
          )}
        </>
      )}
    </section>
  )
}
