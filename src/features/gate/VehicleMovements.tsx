import { DoorClosed, DoorOpen, OctagonX } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useTenant } from '@/features/passes/queries'
import { useNow } from '@/features/passes/useToday'
import { useSession } from '@/features/auth/useAuth'
import { deniedReasons } from '@/features/visits/reasons'
import { gatePassDenial } from '@/features/visits/gatePassDenial'
import { newVisitId } from '@/lib/ids'
import { newRequestId } from '@/lib/requestId'
import { strings } from '@/lib/strings'
import { dwellLimitHoursOf, gateTimeEndsAt, withinGateTime } from '@/lib/visitLogic'
import type { GateDef } from '@/lib/gates'
import type { PassWithId } from '@/types/passes'
import { pendingMovements, useOfflineQueue } from './gateQueue'
import { useCheckInVisit, useCheckOutVisit } from './useGateActions'
import { useVehicleVisits } from './useVehicleVisits'

const t = strings.gateMovements

const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

interface Props {
  vehicleId: string
  plateNo: string
  /** The vehicle's checked-in pass: its first check-in starts the gate time. */
  pass: PassWithId
  gate: GateDef | null
  /** Kept for callers; offline taps are queued, so the buttons no longer depend on it. */
  online?: boolean
  /** Admin, officer and supervisor only look. */
  readOnly: boolean
}

/**
 * After a vehicle's first check-in of the day (the pass check-in): its movements, and for the guard the next step, found
 * from the plate or QR alone. Inside -> CHECK OUT. Outside -> CHECK IN AGAIN while the gate time (16 h from the first
 * check-in by default) lasts, otherwise "no more entries". Check-out is always possible. No PIN: the driver is the one on the pass.
 */
export function VehicleMovements({ vehicleId, plateNo, pass, gate, readOnly }: Props) {
  const { claims, uid } = useSession()
  const queued = useOfflineQueue(uid)
  const waiting = pendingMovements(queued, vehicleId)
  const { checkOut: sendCheckOut, pending: checkingOut } = useCheckOutVisit()
  const { checkInAgain: sendCheckInAgain, pending: checkingIn } = useCheckInVisit()
  const tenant = useTenant(claims.tenantId)
  const now = useNow(30_000)
  const { items, status } = useVehicleVisits(vehicleId)
  const busy = checkingOut || checkingIn
  const [refusal, setRefusal] = useState<{ title: string; lines: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One id pair per intent: a retried tap is the same request, so it can never move the vehicle twice.
  const attempt = useRef<{ visitId: string; requestId: string } | null>(null)

  const hours = dwellLimitHoursOf(tenant.data)
  const firstIn = pass.checkIn?.at?.toMillis() ?? null
  // The visits of this pass, oldest first (visits that predate `passId` match by day).
  const mine = useMemo(
    () => items.filter((v) => (v.passId ? v.passId === pass.id : v.checkIn.dateKey === pass.dateKey)).sort((a, b) => a.checkIn.timestamp.toMillis() - b.checkIn.timestamp.toMillis()),
    [items, pass.id, pass.dateKey],
  )
  const open = mine.find((v) => v.status === 'checked_in') ?? null
  const gateOpen = firstIn !== null && withinGateTime(firstIn, now, hours)

  if (status === 'error') return <NotificationBanner tone="warning">{t.loadFailed}</NotificationBanner>
  if (status === 'loading') return null
  // A pass checked in before movements existed has none: nothing to show or do.
  if (mine.length === 0) return null

  const fresh = () => {
    attempt.current = { visitId: newVisitId(), requestId: newRequestId() }
    return attempt.current
  }

  const report = (o: Awaited<ReturnType<typeof sendCheckOut>>, done: string) => {
    if (o.kind === 'online') {
      attempt.current = null
      toast.success(done)
    } else if (o.kind === 'offline') {
      attempt.current = null // the queued copy keeps the ids
      toast.success(t.savedOffline(plateNo))
    } else if (o.kind === 'error') setError(o.message)
  }

  const checkOut = async () => {
    if (!open || busy) return
    setError(null)
    setRefusal(null)
    const a = attempt.current ?? fresh()
    report(await sendCheckOut({ vehicleId, plateNo }, open.id, a.requestId), t.checkedOut(plateNo))
  }

  const checkInAgain = async () => {
    if (open || busy) return
    setError(null)
    setRefusal(null)
    const a = attempt.current ?? fresh()
    const o = await sendCheckInAgain({ vehicleId, plateNo }, gate?.id, a)
    const res = o.kind === 'online' ? o.data : undefined
    if (!res) return report(o as Awaited<ReturnType<typeof sendCheckOut>>, t.checkedInAgain(plateNo))
    attempt.current = null
    if (res.outcome === 'checked_in') toast.success(t.checkedInAgain(plateNo))
    else if (res.outcome === 'blocked') setRefusal({ title: t.refused, lines: deniedReasons(res.eligibility, { ignoreInspection: true }) })
    else setRefusal({ title: t.refused, lines: [gatePassDenial(res.gatePass), strings.gatePasses.gate.askOffice] })
  }

  const buttonCls =
    'flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-3xl font-black tracking-tight focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60'

  return (
    <section aria-labelledby="movements-title" className="space-y-3 rounded-xl bg-slate-100 px-3 py-3 text-ink">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="movements-title" className="text-sm font-bold text-slate-700">{t.title}</h2>
        <p className="text-sm font-semibold text-slate-700">{t.entries(mine.length)}</p>
      </div>
      <p className="text-lg font-extrabold">{open ? t.inside(hhmm(open.checkIn.timestamp.toMillis())) : t.outside}</p>
      <ol className="space-y-0.5 text-base">
        {mine.map((v, i) => (
          <li key={v.id}>{t.line(i + 1, hhmm(v.checkIn.timestamp.toMillis()), v.checkOut ? hhmm(v.checkOut.timestamp.toMillis()) : null)}</li>
        ))}
      </ol>
      {firstIn !== null && <p className="text-sm font-semibold text-slate-800">{gateOpen ? t.endsAt(hhmm(gateTimeEndsAt(firstIn, hours)), hours) : t.over(hours)}</p>}

      {error && <NotificationBanner tone="error" size="lg" role="alert">{error}</NotificationBanner>}
      {refusal && (
        <section role="alert" className="space-y-1 rounded-xl bg-danger-strong px-3 py-3 text-on-solid">
          <p className="flex items-center gap-2 text-xl font-black"><OctagonX aria-hidden className="size-6" />{refusal.title}</p>
          <p className="text-sm font-bold">{t.refusedFor}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-base font-semibold">
            {refusal.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <NotificationBanner tone="warning" size="lg" title={t.pendingTitle}>
          {waiting.some((i) => i.type === 'checkOutVisit') ? t.pendingCheckOut : t.pendingCheckIn}
        </NotificationBanner>
      )}

      {!readOnly && waiting.length === 0 && (
        <div className="space-y-2">
          {open ? (
            <button type="button" onClick={() => void checkOut()} disabled={busy} aria-busy={busy} className={`${buttonCls} bg-brand text-on-solid hover:bg-brand-hover`}>
              <DoorClosed aria-hidden className="size-8" />
              {busy ? t.checkingOut : t.checkOut}
            </button>
          ) : (
            gateOpen && (
              <button type="button" onClick={() => void checkInAgain()} disabled={busy} aria-busy={busy} className={`${buttonCls} bg-success-strong text-on-solid hover:bg-success-hover`}>
                <DoorOpen aria-hidden className="size-8" />
                {busy ? t.checkingIn : t.checkInAgain}
              </button>
            )
          )}
        </div>
      )}
    </section>
  )
}
