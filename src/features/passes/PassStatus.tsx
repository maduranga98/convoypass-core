import { doc, onSnapshot } from 'firebase/firestore'
import { CheckCircle2, Clock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import type { PassDoc, PassStatus as Status, PassSummary } from '@/types/passes'
import { PassTimeline } from './PassTimeline'


const t = strings.pass.status

interface Props {
  summary: PassSummary
  plateNo?: string
  /** Shown as a "Done" button (after submitting) or "Back to home". */
  onDone?: () => void
  doneLabel?: string
  /** Called when the live pass flips to rejected: the gate resolves the vehicle again. */
  onRejected?: () => void
}

const when = (ms: number | null): string => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : strings.common.none)

/**
 * Status of today's pass. Live (onSnapshot) when the pass belongs to the signed-in driver, because the rules let a
 * driver read only their own passes; otherwise it shows the summary the function returned.
 */
export function PassStatus({ summary, plateNo, onDone, doneLabel = t.done, onRejected }: Props) {
  const [live, setLive] = useState<Pick<PassDoc, 'status' | 'submittedAt' | 'supervisor' | 'officer' | 'checkIn'> | null>(null)

  useEffect(() => {
    if (!summary.mine) return
    return onSnapshot(
      doc(db, 'passes', summary.passId),
      (snap) => {
        const data = snap.data() as PassDoc | undefined
        if (data) {
          setLive({
            status: data.status,
            submittedAt: data.submittedAt,
            ...(data.supervisor ? { supervisor: data.supervisor } : {}),
            ...(data.officer ? { officer: data.officer } : {}),
            ...(data.checkIn ? { checkIn: data.checkIn } : {}),
          })
        }
      },
      () => undefined, // keep showing the last known status
    )
  }, [summary.mine, summary.passId])

  const status: Status = live?.status ?? summary.status
  useEffect(() => {
    if (status === 'rejected') onRejected?.()
  }, [status, onRejected])

  const approved = status === 'officer_approved'
  const checkedIn = status === 'checked_in'
  const Icon = checkedIn ? ShieldCheck : approved ? CheckCircle2 : status === 'rejected' ? TriangleAlert : Clock
  const title = checkedIn ? t.checkedInTitle : approved ? t.approvedTitle : status === 'rejected' ? strings.pass.gate.rejectedTitle : t.pendingTitle
  const body = checkedIn ? t.checkedInBody : approved ? t.approvedBody : status === 'rejected' ? t.rejectedLive : t.pendingBody(plateNo ?? '')

  return (
    <main
      className={cn('flex min-h-dvh flex-col items-center justify-center gap-8 px-6 py-10 text-center', approved || checkedIn ? 'bg-success-strong text-on-solid' : 'bg-slate-50 text-ink')}
    >
      <Icon aria-hidden className={cn('size-24', approved || checkedIn ? 'text-on-solid' : status === 'rejected' ? 'text-danger-strong' : 'text-warning')} />
      <div className="space-y-2">
        <h1 className={cn('font-extrabold tracking-tight', approved || checkedIn ? 'text-5xl' : 'text-3xl')}>{title}</h1>
        <p className={cn('mx-auto max-w-xs text-lg', approved || checkedIn ? 'text-on-solid' : 'text-slate-700')}>{body}</p>
        {plateNo && <p className="text-2xl font-bold">{plateNo}</p>}
        <p className={cn('text-sm', approved || checkedIn ? 'text-on-solid/90' : 'text-slate-600')}>
          {t.submittedBy(summary.driverName)} {t.submittedAt(when(summary.submittedAt))}
        </p>
      </div>
      <div className="w-full max-w-sm"><PassTimeline status={status} tone={approved || checkedIn ? 'success' : 'neutral'} {...(live ? { pass: live } : {})} /></div>
      {onDone && (
        <Button className={cn('h-14 w-full max-w-sm text-lg font-bold', (approved || checkedIn) && 'bg-surface text-success-strong hover:bg-success-soft')} onClick={onDone}>
          {doneLabel}
        </Button>
      )}
    </main>
  )
}
