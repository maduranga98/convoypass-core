import { ArrowLeft, Clock, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { SUMMARY_METRICS, type SummaryMetric } from '@/lib/visitLogic'
import { clock } from './time'
import { useDailySummary } from './queries'

const t = strings.visits.summary

/** Where a role may open a visit. Officers, security and the Yard Officer see the alert, but the full timeline is for the admin and supervisors. */
const detailBase = (role: string): string | null => (role === 'admin' ? '/admin/visits' : role === 'supervisor' ? '/supervisor/visits' : null)

/**
 * Today at a glance, shared by every role that works with visits. The server returns only the tiles a role needs
 * (security: gate counts; Yard Officer: unloading; Safety Officer: suspensions; admin, officer and supervisor: everything),
 * so this page shows exactly what it is given. The dwell alert is a warning only: nothing is blocked.
 */
export default function DailySummaryPage({ backTo }: { backTo?: string }) {
  const { claims } = useSession()
  const summary = useDailySummary()
  const base = detailBase(claims.role)
  const data = summary.data
  const metrics = SUMMARY_METRICS.filter((m): m is SummaryMetric => data !== undefined && data.tiles[m] !== undefined)
  const gate = claims.role === 'security' || claims.role === 'yard'

  return (
    <div className={cn('mx-auto space-y-5', gate ? 'max-w-3xl px-4 py-5' : 'max-w-4xl')}>
      <header className="space-y-1">
        {backTo && (
          <Link to={backTo} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-ink">
            <ArrowLeft aria-hidden className="size-4" />
            {t.back}
          </Link>
        )}
        <h1 className={cn('font-black tracking-tight text-ink', gate ? 'text-3xl' : 'text-xl font-semibold')}>{t.title}</h1>
        {data && (
          <p className="text-sm text-slate-700">
            {t.asOf(clock(data.generatedAt))}
            {claims.role === 'supervisor' ? ` · ${t.contractorScope}` : ''}
          </p>
        )}
      </header>

      {summary.isError ? (
        <ErrorState message={t.loadFailed} error={summary.error} onRetry={() => void summary.refetch()} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {(data.tiles.dwellWarnings ?? 0) > 0 && (
            <NotificationBanner tone="warning" size={gate ? 'lg' : 'md'} title={t.dwellTitle(data.dwellLimitHours)}>
              {t.dwellBody}
            </NotificationBanner>
          )}

          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {metrics.map((m) => {
              const value = data.tiles[m] ?? 0
              const warn = m === 'dwellWarnings' && value > 0
              return (
                <li key={m} className={cn('rounded-2xl border-2 p-4', warn ? 'border-accent bg-accent-soft' : 'border-slate-200 bg-surface')}>
                  <p className={cn('flex items-center gap-2 font-black tracking-tight text-ink tabular-nums', gate ? 'text-5xl' : 'text-4xl')}>
                    {value}
                    {warn && <TriangleAlert aria-hidden className="size-6 text-warning-strong" />}
                  </p>
                  <p className={cn('mt-1 font-semibold text-slate-800', gate ? 'text-base' : 'text-sm')}>{t.tiles[m]}</p>
                </li>
              )
            })}
          </ul>

          {data.tiles.dwellWarnings !== undefined && (
            <section aria-labelledby="dwell-h" className="space-y-2">
              <h2 id="dwell-h" className={cn('font-bold text-ink', gate ? 'text-xl' : 'text-base')}>{t.dwellTitle(data.dwellLimitHours)}</h2>
              {data.dwell.length === 0 ? (
                <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{t.dwellNone}</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-surface">
                  {data.dwell.map((d) => (
                    <li key={d.visitId}>
                      <Row to={base ? `${base}/${d.visitId}` : null}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg leading-tight font-black tracking-tight text-ink">{d.plateNo}</span>
                          <span className="block text-sm text-slate-700">{d.driverName}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-sm font-extrabold text-ink">
                          <Clock aria-hidden className="size-4" />
                          {t.dwellHours(d.hours)}
                        </span>
                      </Row>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Row({ to, children }: { to: string | null; children: ReactNode }) {
  const cls = 'flex min-h-14 items-center gap-3 px-4 py-3'
  return to ? (
    <Link to={to} className={cn(cls, 'hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus')}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  )
}
