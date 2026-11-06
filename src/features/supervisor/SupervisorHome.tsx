import { ArrowRight, CalendarCheck, CheckCircle2, Clock, Plus, QrCode, Truck, UserRoundPlus, Users, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { timeAgo, toMs } from '@/features/passes/passView'
import { QUEUE_LIMIT, usePassQueue, type PassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import { useDrivers, useVehicles } from '@/features/shared/queries'
import { PassRow } from './PassRow'
import { isOverdue, oldestFirst, TAB_STATUSES } from './queue'
import { useSupervisorTarget } from './useSupervisorTarget'

const t = strings.supervisor
const NEXT_UP = 5

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** A live count from a pass listener: skeleton while loading, a dash on error, `99+` at the listener cap. */
const queueCount = (q: PassQueue): ReactNode =>
  q.isLoading && q.items.length === 0 ? <Skeleton className="h-8 w-10" /> : q.isError && q.items.length === 0 ? strings.common.none : q.items.length >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : q.items.length

function Stat({ to, icon, label, value, tone }: { to: string; icon: ReactNode; label: string; value: ReactNode; tone: 'success' | 'danger' | 'brand' }) {
  return (
    <Link to={to} className={cn('flex items-center gap-3 rounded-xl border border-slate-200 bg-surface p-4 shadow-sm hover:border-slate-300', focusRing)}>
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5',
          tone === 'success' ? 'bg-success-soft text-success-strong' : tone === 'danger' ? 'bg-danger-soft text-danger-strong' : 'bg-slate-100 text-ink',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums leading-tight tracking-tight">{value}</span>
        <span className="block truncate text-sm text-slate-600">{label}</span>
      </span>
    </Link>
  )
}

function Action({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className={cn('flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-slate-50 [&>svg]:size-5', focusRing)}>
      {icon}
      <span className="flex-1">{label}</span>
      <ArrowRight aria-hidden className="text-slate-500" />
    </Link>
  )
}

export default function SupervisorHome() {
  const { profile } = useSession()
  const today = useToday()
  const now = useNow()
  const target = useSupervisorTarget()
  const day = today ? { dateKey: today } : {}
  const enabled = today !== null
  // The same listeners as the Approvals tabs (and the nav badge), so the numbers always agree.
  const pending = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.pending, ...day, enabled })
  const approved = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.approved, ...day, enabled })
  const rejected = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.rejected, ...day, enabled })
  const vehicles = useVehicles('supervisor')
  const drivers = useDrivers('supervisor')
  const listCount = (q: { isPending: boolean; isError: boolean; data?: { items: unknown[] } }): ReactNode =>
    q.isPending ? <Skeleton className="h-8 w-10" /> : q.isError ? strings.common.none : q.data?.items.length

  const loading = !enabled || (pending.isLoading && pending.items.length === 0)
  const waiting = oldestFirst(pending.items)
  const oldest = waiting[0]
  const overdue = waiting.filter((p) => isOverdue(p, now, target)).length
  const dateLine = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-600">{dateLine}</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{strings.home.welcome(profile.name)}</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* The queue: the one thing a supervisor opens the app for. */}
          <section aria-labelledby="sup-queue" className="overflow-hidden rounded-2xl bg-brand text-on-solid shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="min-w-0">
                <h2 id="sup-queue" className="text-sm font-semibold text-slate-300">{t.homePendingTitle}</h2>
                <p className="mt-1 flex items-baseline gap-3">
                  <span className="text-5xl font-extrabold tabular-nums tracking-tight">{loading ? strings.common.none : queueCount(pending)}</span>
                  <span aria-live="polite" className="text-base font-medium">{loading ? strings.common.loading : t.homePending(waiting.length)}</span>
                </p>
                {!loading && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {oldest ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-300">
                        <Clock aria-hidden className="size-4" />
                        {t.homeOldest(timeAgo(toMs(oldest.submittedAt), now).toLowerCase())}
                      </span>
                    ) : (
                      <span className="text-slate-300">{t.homeAllClear}</span>
                    )}
                    {overdue > 0 && <span className="rounded-full bg-accent px-2.5 py-0.5 font-bold text-ink">{t.homeOverdue(overdue)}</span>}
                  </div>
                )}
              </div>
              <Link
                to={oldest ? `/supervisor/approvals/${oldest.id}` : '/supervisor/approvals'}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-base font-bold text-ink hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
              >
                {oldest ? t.reviewNow : t.openApprovals}
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            </div>
          </section>

          <section aria-labelledby="sup-today" className="space-y-3">
            <h2 id="sup-today" className="text-base font-semibold">{t.todayTitle}</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat to="/supervisor/approvals?tab=approved" tone="success" icon={<CheckCircle2 aria-hidden />} label={t.approvedToday} value={queueCount(approved)} />
              <Stat to="/supervisor/approvals?tab=rejected" tone="danger" icon={<XCircle aria-hidden />} label={t.rejectedToday} value={queueCount(rejected)} />
            </div>
          </section>

          {waiting.length > 0 && (
            <section aria-labelledby="sup-next" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 id="sup-next" className="text-base font-semibold">{t.nextUp}</h2>
                <Link to="/supervisor/approvals" className={cn('inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink hover:underline', focusRing)}>
                  {t.seeAll}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
              <ul aria-labelledby="sup-next" className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
                {waiting.slice(0, NEXT_UP).map((p) => (
                  <PassRow key={p.id} pass={p} now={now} today={today} to={`/supervisor/approvals/${p.id}`} overdue={isOverdue(p, now, target)} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside aria-labelledby="sup-fleet" className="space-y-3">
          <h2 id="sup-fleet" className="text-base font-semibold">{t.fleetTitle}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat to="/supervisor/vehicles" tone="brand" icon={<Truck aria-hidden />} label={t.vehicles} value={listCount(vehicles)} />
            <Stat to="/supervisor/drivers" tone="brand" icon={<Users aria-hidden />} label={t.drivers} value={listCount(drivers)} />
          </div>
          <nav aria-label={t.quickActions} className="rounded-xl border border-slate-200 bg-surface p-2 shadow-sm">
            <Action to="/supervisor/assign-drivers" icon={<UserRoundPlus aria-hidden />} label={t.nav.assign} />
            <Action to="/supervisor/daily" icon={<CalendarCheck aria-hidden />} label={t.nav.daily} />
            <Action to="/supervisor/vehicles?new=1" icon={<Plus aria-hidden />} label={strings.vehicles.add} />
            <Action to="/supervisor/drivers?new=1" icon={<Plus aria-hidden />} label={strings.drivers.add} />
            <Action to="/supervisor/qr" icon={<QrCode aria-hidden />} label={t.nav.qr} />
          </nav>
        </aside>
      </div>
    </div>
  )
}
