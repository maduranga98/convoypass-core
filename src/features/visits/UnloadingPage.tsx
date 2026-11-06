import { Check, PackageCheck, PackageX, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { dismissQueued, pendingUnloadingVisitIds, useOfflineQueue } from '@/features/gate/gateQueue'
import { useLogUnloading } from '@/features/gate/useGateActions'
import { useNow } from '@/features/passes/useToday'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { UNLOAD_LOCATION_MAX, UNLOAD_LOCATION_MIN } from '@/lib/visitLogic'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'
import { matchesVisit, recentLocations } from './filters'
import { useActiveVisits } from './queries'
import { clock, elapsed } from './time'
import { DwellChip, UnloadChip } from './VisitChips'

const t = strings.visits.yard

/**
 * Yard Officer home: every vehicle that is on site, longest first. Tap one: unloaded yes or no, and where. Saving writes
 * only the unloading part of the visit (a callable); the officer can correct it while the vehicle is still on site.
 */
export default function UnloadingPage() {
  const active = useActiveVisits()
  const now = useNow(30_000)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<WithId<Visit> | null>(null)
  const shown = useMemo(() => active.items.filter((v) => matchesVisit(v, q)), [active.items, q])
  const places = useMemo(() => recentLocations(active.items), [active.items])
  const { uid } = useSession()
  const queued = useOfflineQueue(uid)
  const unloadingItems = queued.filter((i) => i.type === 'logUnloading')
  const waiting = unloadingItems.filter((i) => i.status === 'waiting')
  const failed = unloadingItems.filter((i) => i.status === 'failed')
  const pendingIds = useMemo(() => pendingUnloadingVisitIds(queued), [queued])

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <h1 className="text-3xl font-black tracking-tight text-ink">{t.title}</h1>

      <label className="relative block">
        <span className="sr-only">{strings.visits.search}</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={strings.visits.search}
          autoComplete="off"
          className="h-16 w-full rounded-2xl border-2 border-slate-300 bg-surface pr-4 pl-13 text-xl font-bold placeholder:text-base placeholder:font-medium focus-visible:border-brand focus-visible:outline-none"
        />
      </label>

      <p className="text-base font-semibold text-slate-700">{t.onSite(active.items.length)} · {t.oldestFirst}</p>

      {waiting.length > 0 && <NotificationBanner tone="warning" size="lg" title={t.pendingSync}>{t.pendingBanner(waiting.length)}</NotificationBanner>}
      {failed.map((i) => (
        <NotificationBanner
          key={i.requestId}
          tone="warning"
          size="lg"
          role="alert"
          action={<button type="button" onClick={() => void dismissQueued(uid, i.requestId)} className="h-11 rounded-lg border-2 border-slate-300 bg-surface px-4 text-base font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{t.dismiss}</button>}
        >
          {t.failedBanner(i.plateNo, i.error ?? '')}
        </NotificationBanner>
      ))}

      {active.status === 'error' ? (
        <ErrorState message={strings.visits.loadFailed} error={active.error} onRetry={active.retry} />
      ) : active.status === 'loading' ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-surface">
          <EmptyState title={q ? strings.visits.noMatch : t.emptyTitle} {...(q ? {} : { body: t.emptyBody })} />
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((v) => {
            const e = elapsed(v.checkIn.timestamp.toMillis(), now)
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setPick(v)}
                  className="flex min-h-20 w-full items-center gap-3 rounded-2xl border-2 border-slate-200 bg-surface px-4 py-3 text-left hover:border-slate-400 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-2xl leading-tight font-black tracking-tight text-ink">{v.plateNo}</span>
                    <span className="block text-base font-semibold text-slate-700">{v.driverName}</span>
                    <span className="block text-sm text-slate-700">
                      {strings.visits.onSiteFor(e.hours, e.minutes)} · {strings.visits.since(clock(v.checkIn.timestamp.toMillis()))}
                      {v.unloadingCheck?.unloadLocation ? ` · ${v.unloadingCheck.unloadLocation}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <UnloadChip visit={v} />
                    {pendingIds.has(v.id) && <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-sm font-extrabold text-ink">{t.pendingSync}</span>}
                    {v.dwellWarning && <DwellChip />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <UnloadSheet visit={pick} places={places} onClose={() => setPick(null)} />
    </div>
  )
}

function UnloadSheet({ visit, places, onClose }: { visit: WithId<Visit> | null; places: string[]; onClose: () => void }) {
  // Remount per visit so the form starts from what was already logged.
  return (
    <Modal open={visit !== null} onClose={onClose} title={t.sheetTitle} variant="sheet">
      {visit && <UnloadForm key={visit.id} visit={visit} places={places} onClose={onClose} />}
    </Modal>
  )
}

function UnloadForm({ visit, places, onClose }: { visit: WithId<Visit>; places: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { logUnloading } = useLogUnloading()
  const [unloaded, setUnloaded] = useState<boolean | null>(visit.unloadingCheck?.unloaded ?? null)
  const [place, setPlace] = useState(visit.unloadingCheck?.unloadLocation ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = place.trim().replace(/\s+/g, ' ')
  const placeOk = trimmed.length >= UNLOAD_LOCATION_MIN && trimmed.length <= UNLOAD_LOCATION_MAX
  const canSave = unloaded === false || (unloaded === true && placeOk)

  const save = async () => {
    if (unloaded === null || !canSave) return
    setBusy(true)
    setError(null)
    const o = await logUnloading({ vehicleId: visit.vehicleId, plateNo: visit.plateNo }, visit.id, { unloaded, ...(unloaded ? { unloadLocation: trimmed } : {}) })
    setBusy(false)
    if (o.kind === 'error') return setError(o.message)
    if (o.kind === 'ignored') return
    if (o.kind === 'online') {
      void queryClient.invalidateQueries({ queryKey: ['dailySummary'] })
      toast.success(`${visit.plateNo}: ${t.saved}`)
    } else {
      toast.success(`${visit.plateNo}: ${t.savedOffline}`)
    }
    onClose()
  }

  const choice = (value: boolean, label: string, Icon: typeof Check) => (
    <button
      type="button"
      aria-pressed={unloaded === value}
      onClick={() => setUnloaded(value)}
      className={cn(
        'flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 text-lg font-black focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus',
        unloaded === value ? (value ? 'border-success-strong bg-success-strong text-on-solid' : 'border-brand bg-brand text-on-solid') : 'border-slate-300 bg-surface text-ink',
      )}
    >
      <Icon aria-hidden className="size-7" />
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <p className="text-4xl leading-tight font-black tracking-tight text-ink">{visit.plateNo}</p>
        <p className="text-lg font-semibold text-slate-800">{visit.driverName}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-lg font-bold text-ink">{t.question}</legend>
        <div className="grid grid-cols-2 gap-3">
          {choice(true, t.yes, PackageCheck)}
          {choice(false, t.no, PackageX)}
        </div>
      </fieldset>

      {unloaded === true && (
        <div className="space-y-2">
          <label htmlFor="unload-place" className="text-lg font-bold text-ink">{t.location}</label>
          <input
            id="unload-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            maxLength={UNLOAD_LOCATION_MAX}
            placeholder={t.locationHint}
            autoComplete="off"
            className="h-16 w-full rounded-2xl border-2 border-slate-300 bg-surface px-4 text-xl font-bold placeholder:text-base placeholder:font-medium focus-visible:border-brand focus-visible:outline-none"
          />
          {places.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700">{t.recent}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {places.map((p) => (
                  <li key={p}>
                    <button type="button" onClick={() => setPlace(p)} className="h-12 rounded-full border-2 border-slate-300 bg-surface px-4 text-base font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {place.length > 0 && !placeOk && <p className="text-sm font-semibold text-danger-ink">{t.locationShort}</p>}
        </div>
      )}

      {error && <NotificationBanner tone="error" size="lg" role="alert">{error}</NotificationBanner>}

      <button
        type="button"
        disabled={!canSave || busy}
        onClick={() => void save()}
        className="h-16 w-full rounded-2xl bg-brand text-xl font-black text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
      >
        {busy ? strings.common.saving : t.save}
      </button>
    </div>
  )
}
