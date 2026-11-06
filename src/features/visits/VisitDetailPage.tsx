import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTenant } from '@/features/passes/queries'
import { useSession } from '@/features/auth/useAuth'
import { useNow } from '@/features/passes/useToday'
import type { Scope } from '@/features/shared/scope'
import { strings } from '@/lib/strings'
import { dwellLimitHoursOf } from '@/lib/visitLogic'
import { useVisit } from './queries'
import { dateTime, elapsed } from './time'
import { UnloadChip } from './VisitChips'
import { VisitTimeline } from './VisitTimeline'

const t = strings.visits.detail

/** One visit in full: who and what, and the three-stage timeline. Read only, for the admin and supervisors. */
export default function VisitDetailPage({ scope }: { scope: Scope }) {
  const { visitId } = useParams()
  const { claims } = useSession()
  const visit = useVisit(visitId)
  const tenant = useTenant(claims.tenantId)
  const back = `/${scope}/visits`

  const v = visit.data
  const now = useNow(60_000)
  const end = v?.checkOut?.timestamp.toMillis() ?? now
  const spent = v ? elapsed(v.checkIn.timestamp.toMillis(), end) : null

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>

      {visit.isError ? (
        <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />
      ) : visit.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : !v ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={t.notFound} body={t.notFoundBody} />
        </div>
      ) : (
        <>
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{v.plateNo}</h1>
            <p className="text-sm text-slate-700">{t.title} · {dateTime(v.checkIn.timestamp.toMillis())}</p>
          </header>

          {v.dwellWarning && v.status === 'checked_in' && (
            <NotificationBanner tone="warning">{t.dwell(dwellLimitHoursOf(tenant.data))}</NotificationBanner>
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-surface p-4 text-sm">
            <div>
              <dt className="text-slate-600">{t.vehicle}</dt>
              <dd className="font-semibold text-ink">
                <Link to={`/${scope}/vehicles`} className="underline-offset-2 hover:underline">{v.plateNo}</Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">{t.driver}</dt>
              <dd className="font-semibold text-ink">
                <Link to={`/${scope}/drivers`} className="underline-offset-2 hover:underline">{v.driverName}</Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">{t.duration}</dt>
              <dd className="font-semibold text-ink">{spent ? strings.visits.onSiteFor(spent.hours, spent.minutes) : strings.common.none}</dd>
            </div>
            <div>
              <dt className="text-slate-600">{t.unloading}</dt>
              <dd className="mt-0.5"><UnloadChip visit={v} /></dd>
            </div>
          </dl>

          <section className="rounded-xl border border-slate-200 bg-surface p-4">
            <h2 className="mb-4 text-base font-semibold text-ink">{t.timeline}</h2>
            <VisitTimeline visit={v} />
          </section>
        </>
      )}
    </div>
  )
}
