import { ArrowLeft, CircleCheckBig, Clock, DoorClosed, DoorOpen, LogIn, PackageCheck, RefreshCw, ShieldBan, TriangleAlert, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { useSession } from '@/features/auth/useAuth'
import { useOnline } from '@/features/passes/useOnline'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { dismissQueued, syncQueue, useOfflineQueue, useQueueSyncing } from './gateQueue'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.gate.queue

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })

/** `/security/queue`: what this phone still has to send, and what the server refused (kept until dismissed). */
export default function QueuePage() {
  const { uid } = useSession()
  const items = useOfflineQueue(uid)
  const syncing = useQueueSyncing(uid)
  const online = useOnline()

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <Link to="/security" className="inline-flex h-11 items-center gap-1 rounded-lg text-base font-semibold focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-5" />
        {t.back}
      </Link>
      <div>
        <h1 className="text-2xl font-black tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-700">{t.intro}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-surface">
          <EmptyState icon={<CircleCheckBig aria-hidden />} title={t.empty} body={t.emptyBody} />
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const failed = item.status === 'failed'
            return (
              <li key={item.requestId} className={cn('space-y-2 rounded-2xl border-2 bg-surface p-4', failed ? 'border-accent' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-2xl leading-tight font-black tracking-tight">{item.plateNo}</p>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      {(() => {
                        const Icon = { checkIn: LogIn, deny: ShieldBan, checkInVisit: DoorOpen, checkOutVisit: DoorClosed, logUnloading: PackageCheck }[item.type]
                        return <Icon aria-hidden className="size-4" />
                      })()}
                      {{ checkIn: t.checkIn, deny: t.deny, checkInVisit: t.checkInAgain, checkOutVisit: t.checkOut, logUnloading: t.unloading }[item.type]}
                    </p>
                    <p className="text-sm text-slate-700">{t.captured(when(item.capturedAtISO))}</p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-extrabold',
                      failed ? 'bg-accent text-ink' : 'bg-slate-200 text-ink',
                    )}
                  >
                    {failed ? <TriangleAlert aria-hidden className="size-4" /> : <Clock aria-hidden className="size-4" />}
                    {failed ? t.failed : t.waiting}
                  </span>
                </div>
                {item.error && <NotificationBanner tone="warning" role="alert" size="lg">{item.error}</NotificationBanner>}
                {failed ? (
                  <button
                    type="button"
                    onClick={() => void dismissQueued(uid, item.requestId)}
                    className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-slate-300 px-4 text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <X aria-hidden className="size-5" />
                    {t.dismiss}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={syncing || !online}
                    onClick={() => void syncQueue(uid)}
                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-4 text-base font-bold text-on-solid disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <RefreshCw aria-hidden className={cn('size-5', syncing && 'animate-spin')} />
                    {syncing ? t.syncing : t.retry}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
