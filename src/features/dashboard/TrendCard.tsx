import { RefreshCw } from 'lucide-react'
import { lazy, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ChartPanel } from '@/features/shared/ChartPanel'
import { formatTime } from '@/features/passes/passView'
import { strings } from '@/lib/strings'
import type { TrendDay } from '@/types/reports'
import { useTrend } from './hooks'
import { toDay } from './links'

const TrendChart = lazy(() => import('./TrendChart'))
const t = strings.dashboard.trend
const PERIODS = [7, 14, 30] as const

export function TrendTable({ days }: { days: TrendDay[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t.title}</caption>
        <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="py-2 pr-4">{t.day}</th>
            <th scope="col" className="px-2 py-2 text-right">{t.series.submitted}</th>
            <th scope="col" className="px-2 py-2 text-right">{strings.dashboard.kpis.approved}</th>
            <th scope="col" className="px-2 py-2 text-right">{t.series.checkedIn}</th>
            <th scope="col" className="px-2 py-2 text-right">{t.series.rejected}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {[...days].reverse().map((d) => (
            <tr key={d.dateKey}>
              <th scope="row" className="py-2 pr-4 font-medium text-slate-700">{toDay(d.dateKey)}</th>
              <td className="px-2 py-2 text-right">{d.submitted}</td>
              <td className="px-2 py-2 text-right">{d.approved}</td>
              <td className="px-2 py-2 text-right">{d.checkedIn}</td>
              <td className="px-2 py-2 text-right">{d.rejected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 7 / 14 / 30 day trend from `getDashboardTrend`, with a table version and a manual refresh. */
export function TrendCard() {
  const [days, setDays] = useState<7 | 14 | 30>(14)
  const trend = useTrend(days)
  const data = trend.data?.days ?? []
  const empty = data.every((d) => d.submitted === 0)

  const controls = (
    <div className="flex items-center gap-2">
      <div role="group" aria-label={t.daysLabel} className="inline-flex overflow-hidden rounded-lg border border-slate-300">
        {PERIODS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={days === n}
            onClick={() => setDays(n)}
            className={`h-9 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus ${days === n ? 'bg-brand text-on-solid' : 'bg-surface text-slate-700 hover:bg-slate-50'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="icon" aria-label={t.refresh} disabled={trend.isFetching} onClick={() => void trend.refetch()}>
        <RefreshCw aria-hidden className={`size-4 ${trend.isFetching ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )

  if (trend.isPending) return <Skeleton className="h-80 w-full rounded-xl" />
  if (trend.isError && !trend.data) return <ErrorState message={t.loadFailed} error={trend.error} onRetry={() => void trend.refetch()} />

  return (
    <div className="space-y-2">
      <ChartPanel
        title={`${t.title} · ${t.range(days)}`}
        label={strings.dashboard.trend.chartLabel(days)}
        actions={controls}
        chart={empty ? <p className="grid h-full place-items-center text-sm text-slate-500">{t.empty}</p> : <TrendChart days={data} />}
        table={<TrendTable days={data} />}
      />
      {trend.data && <p className="text-xs text-slate-500">{t.updated(formatTime(trend.dataUpdatedAt))}</p>}
    </div>
  )
}
