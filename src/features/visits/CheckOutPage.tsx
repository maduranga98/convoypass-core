import { CircleCheckBig, ScanLine, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useNow } from '@/features/passes/useToday'
import { checkOutVisit } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { newRequestId } from '@/lib/requestId'
import { strings } from '@/lib/strings'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'
import { useQueryClient } from '@tanstack/react-query'
import { matchesVisit } from './filters'
import { useActiveVisits } from './queries'
import { clock, elapsed } from './time'
import { DwellChip, UnloadChip } from './VisitChips'

const t = strings.visits.checkOut
const QrScanner = lazy(() => import('@/features/scan/QrScanner').then((m) => ({ default: m.QrScanner })))

/**
 * Security: vehicles that are on site, longest first. Scan the QR (or tap a row), confirm, done. No eligibility is checked
 * on the way out. The driver is freed for the next visit.
 */
export default function CheckOutPage() {
  const active = useActiveVisits()
  const now = useNow(30_000)
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [scanning, setScanning] = useState(false)
  const [pick, setPick] = useState<WithId<Visit> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; warn: string | null } | null>(null)
  // One request id per confirmation: a retry of the same tap is the same request.
  const requestId = useRef<string | null>(null)

  const shown = useMemo(() => active.items.filter((v) => matchesVisit(v, q)), [active.items, q])

  const open = (v: WithId<Visit>) => {
    requestId.current = newRequestId()
    setError(null)
    setNotice(null)
    setPick(v)
  }

  const onScanned = (vehicleId: string) => {
    setScanning(false)
    const found = active.items.find((v) => v.vehicleId === vehicleId)
    if (found) open(found)
    else {
      setPick(null)
      setNotice(null)
      setError(strings.visits.notCheckedIn)
    }
  }

  const confirm = async () => {
    if (!pick) return
    setBusy(true)
    setError(null)
    try {
      const res = await checkOutVisit({ visitId: pick.id, requestId: requestId.current ?? newRequestId() })
      setNotice({ text: t.done(pick.plateNo), warn: res.unloadingMissing ? t.doneMissing : null })
      setPick(null)
      void queryClient.invalidateQueries({ queryKey: ['dailySummary'] })
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <h1 className="text-3xl font-black tracking-tight text-ink">{t.title}</h1>

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="flex h-24 w-full items-center justify-center gap-4 rounded-3xl bg-brand text-3xl font-black tracking-tight text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <ScanLine aria-hidden className="size-10" />
        {t.scan}
      </button>

      {notice && (
        <NotificationBanner tone="success" size="lg" onDismiss={() => setNotice(null)}>
          <span className="flex flex-col gap-0.5 text-lg font-bold">
            <span className="inline-flex items-center gap-2"><CircleCheckBig aria-hidden className="size-5" />{notice.text}</span>
            <span className="font-medium">{t.driverFree}</span>
            {notice.warn && <span className="font-medium">{notice.warn}</span>}
          </span>
        </NotificationBanner>
      )}
      {error && !pick && <NotificationBanner tone="error" size="lg" role="alert">{error}</NotificationBanner>}

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

      <p className="text-base font-semibold text-slate-700">{t.onSite(active.items.length)}</p>

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
                  onClick={() => open(v)}
                  className="flex min-h-20 w-full items-center gap-3 rounded-2xl border-2 border-slate-200 bg-surface px-4 py-3 text-left hover:border-slate-400 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-2xl leading-tight font-black tracking-tight text-ink">{v.plateNo}</span>
                    <span className="block text-base font-semibold text-slate-700">{v.driverName}</span>
                    <span className="block text-sm text-slate-700">{strings.visits.onSiteFor(e.hours, e.minutes)} · {strings.visits.since(clock(v.checkIn.timestamp.toMillis()))}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <UnloadChip visit={v} />
                    {v.dwellWarning && <DwellChip />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Link to="/security" className="block py-2 text-center text-base font-semibold text-slate-700 underline">{strings.visits.checkOut.cancel}</Link>

      <Modal
        open={pick !== null}
        onClose={() => (busy ? undefined : setPick(null))}
        title={t.confirmTitle}
        variant="sheet"
        footer={
          <div className="grid w-full grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => setPick(null)} className="h-16 rounded-2xl border-2 border-slate-300 text-xl font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
              {t.cancel}
            </button>
            <button type="button" disabled={busy} onClick={() => void confirm()} className="h-16 rounded-2xl bg-brand text-xl font-black text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
              {busy ? strings.common.saving : t.confirm}
            </button>
          </div>
        }
      >
        {pick && (
          <div className="space-y-3">
            <p className="text-4xl leading-tight font-black tracking-tight text-ink">{pick.plateNo}</p>
            <p className="text-xl font-semibold text-slate-800">{pick.driverName}</p>
            <UnloadChip visit={pick} />
            {pick.unloadingCheck === null && <NotificationBanner tone="warning" size="lg">{t.unloadingMissing}</NotificationBanner>}
            {error && <NotificationBanner tone="error" size="lg" role="alert">{error}</NotificationBanner>}
          </div>
        )}
      </Modal>

      {scanning && (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-scrim text-lg font-semibold text-on-solid">{strings.scanner.starting}</div>}>
          <QrScanner onClose={() => setScanning(false)} onVehicle={onScanned} />
        </Suspense>
      )}
    </div>
  )
}
