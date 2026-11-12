import { CircleAlert, CircleCheckBig, DoorOpen, LogIn, ScanLine, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { useDriverPhotoUrl } from '@/features/shared/queries'
import { GatePicker } from '@/features/gate/GatePicker'
import { playTone } from '@/features/gate/feedback'
import { useGates } from '@/features/gate/useGate'
import { checkInVisitorPass, checkOutVisitorPass } from '@/lib/api'
import { cn } from '@/lib/cn'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { newRequestId } from '@/lib/requestId'
import { visitorStrings } from '@/lib/visitorStrings'
import type { GateDef } from '@/lib/gates'
import type { VisitorPassView } from '@/types/visitors'
import { elapsedParts, hhmm, isoDay, validLabel } from './format'
import { TONE, verdictOf } from './verdict'

const t = visitorStrings.gate

const big = 'flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-2xl font-black focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60'

/**
 * One visitor pass at the gate: the verdict in big words, who they are (photo, host, purpose, validity) and one large button,
 * CHECK IN or CHECK OUT. `readOnly` (admin, supervisor, Safety Officer opening the QR link) shows the same facts without buttons.
 * Check-in and check-out are idempotent on a request id kept until the call succeeds, so a retry never records twice.
 */
export function VisitorPassCard({ view, readOnly = false, now, onNext }: { view: VisitorPassView; readOnly?: boolean; now: number; onNext: () => void }) {
  const { gates, gate, setGate } = useGates()
  const photo = useDriverPhotoUrl(view.photoPath)
  const [busy, setBusy] = useState<'in' | 'out' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ kind: 'in' | 'out'; at: number } | null>(null)
  const [picking, setPicking] = useState(false)
  const ids = useRef<{ in?: string; out?: string }>({})
  const verdict = verdictOf(view, gate)
  const inside = view.status === 'checked_in'
  const canCheckIn = !readOnly && verdict.tone === 'go' && view.status === 'active'

  const run = async (kind: 'in' | 'out', site: GateDef | null) => {
    setError(null)
    if (kind === 'in' && !site) {
      setPicking(true)
      return
    }
    setBusy(kind)
    try {
      const requestId = (ids.current[kind] ??= newRequestId())
      const res = kind === 'in'
        ? await checkInVisitorPass({ passId: view.passId, siteId: (site as GateDef).id, requestId })
        : await checkOutVisitorPass({ passId: view.passId, requestId })
      playTone('ok')
      setDone({ kind, at: res.at })
    } catch (e) {
      // A typed refusal will not change on retry: forget the request id. A network failure keeps it, so a retry is the same request.
      if (apiErrorReason(e) !== null) delete ids.current[kind]
      playTone('blocked')
      setError(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <section aria-live="polite" className="space-y-4">
        <div role="status" className={cn('flex flex-col items-center gap-2 rounded-3xl px-4 py-8 text-center', done.kind === 'in' ? TONE.go : TONE.info)}>
          {done.kind === 'in' ? <CircleCheckBig aria-hidden className="size-16" /> : <DoorOpen aria-hidden className="size-16" />}
          <p className="text-4xl font-black">{done.kind === 'in' ? t.done.in : t.done.out}</p>
          <p className="text-2xl font-bold">{view.visitorName}</p>
          <p className="text-lg font-semibold">{hhmm(done.at)}</p>
        </div>
        <button type="button" onClick={onNext} className={cn(big, 'bg-brand text-on-solid hover:bg-brand-hover')}>
          <ScanLine aria-hidden className="size-8" />
          {t.scanAnother}
        </button>
      </section>
    )
  }

  const stay = view.checkInAt ? elapsedParts(view.checkInAt, now) : null
  return (
    <section className="space-y-4">
      <div role="status" className={cn('flex items-center gap-3 rounded-3xl px-5 py-5', TONE[verdict.tone])}>
        <verdict.Icon aria-hidden className="size-10 shrink-0" />
        <div className="min-w-0">
          <p className="text-2xl leading-tight font-black">{verdict.label}</p>
          {verdict.reason && <p className="text-base font-semibold">{verdict.reason}</p>}
        </div>
      </div>
      {view.overstay && (
        <p role="status" className="flex items-center gap-2 rounded-2xl border-2 border-danger-strong px-4 py-3 text-lg font-extrabold text-danger-ink">
          <TriangleAlert aria-hidden className="size-6 shrink-0" />
          {t.overstay}
        </p>
      )}

      <div className="flex items-start gap-4 rounded-2xl border-2 border-slate-200 bg-surface p-4">
        {photo.data ? (
          <img src={photo.data} alt="" className="size-28 shrink-0 rounded-2xl border-2 border-slate-300 object-cover" />
        ) : (
          <span aria-hidden className="grid size-28 shrink-0 place-items-center rounded-2xl border-2 border-slate-300 bg-slate-100 text-4xl font-black text-slate-600">
            {view.visitorName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <p className="text-2xl leading-tight font-black break-words text-ink">{view.visitorName}</p>
          {view.organization && <p className="text-lg text-slate-700">{view.organization}</p>}
          <dl className="space-y-0.5 pt-1 text-base">
            {view.hostName && <Line label={t.host} value={view.hostName} />}
            <Line label={t.purpose} value={view.purposeOfVisit} />
            <Line label={t.valid} value={validLabel(isoDay(view.validFrom), isoDay(view.validUntil))} />
            {view.checkInAt && <Line label="" value={t.since(hhmm(view.checkInAt))} />}
            {stay && inside && <Line label="" value={visitorStrings.onSite.elapsed(stay.hours, stay.minutes)} />}
          </dl>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-lg font-bold text-danger-ink">
          <CircleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
          {error}
        </p>
      )}

      {readOnly ? (
        <p className="text-center text-base font-semibold text-slate-700">{visitorStrings.page.readOnly}</p>
      ) : (
        <div className="space-y-3">
          {canCheckIn && (
            <button type="button" disabled={busy !== null} onClick={() => void run('in', gate)} className={cn(big, 'bg-success-strong text-on-solid hover:opacity-90')}>
              <LogIn aria-hidden className="size-8" />
              {busy === 'in' ? t.checkingIn : t.checkIn}
            </button>
          )}
          {inside && (
            <button type="button" disabled={busy !== null} onClick={() => void run('out', gate)} className={cn(big, 'bg-brand text-on-solid hover:bg-brand-hover')}>
              <DoorOpen aria-hidden className="size-8" />
              {busy === 'out' ? t.checkingOut : t.checkOut}
            </button>
          )}
          <button type="button" onClick={onNext} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-surface text-lg font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t.back}
          </button>
        </div>
      )}

      {!readOnly && (
        <GatePicker
          open={picking}
          gates={gates}
          current={gate?.id ?? null}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            const chosen = gates.find((g) => g.id === id) ?? null
            setGate(id)
            setPicking(false)
            void run('in', chosen)
          }}
        />
      )}
    </section>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      {label && <dt className="shrink-0 text-slate-600">{label}</dt>}
      <dd className="font-semibold break-words text-ink">{value}</dd>
    </div>
  )
}
