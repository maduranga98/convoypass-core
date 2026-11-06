import { ChevronDown, ChevronUp, Keyboard, ShieldX, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { DecisionBar } from '@/features/passes/DecisionBar'
import { PassChangedBanner } from '@/features/passes/PassChangedBanner'
import { PassReview } from '@/features/passes/PassReview'
import { vehicleHistoryLink } from '@/features/reports/filters'
import { isExpired } from '@/features/passes/passView'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useReviewShortcuts } from '@/features/passes/shortcuts'
import type { useDecisions } from '@/features/passes/useDecisions'
import { useReviewLock } from '@/features/passes/useReviewLock'
import type { RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import type { PassWithId } from '@/types/passes'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.officer.panel
const a = strings.approvals

const navButton = cn(
  'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-on-solid hover:bg-brand-hover pointer-coarse:size-11',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid disabled:cursor-not-allowed disabled:opacity-40',
)

interface Props {
  /** The live version of the pass. */
  pass: PassWithId
  today: string | null
  contractorName: string
  reasons: readonly RejectionReasonDef[]
  decisions: ReturnType<typeof useDecisions>
  /** Position in the current list, for J/K and the "3 of 12" label. */
  position: { index: number; total: number }
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
  /** Called after a successful decision so the list can move on. */
  onDecided: () => void
  /** Revoke an approved pass that has not checked in yet. */
  onRevoke: (pass: PassWithId) => void
  /** Shortcuts stand down while another dialog (bulk confirm, revoke) is open. */
  suspendShortcuts: boolean
}

/**
 * Right-side review panel. Remounted per pass (`key={pass.id}`) so what was "seen" starts fresh. Officers approve or
 * reject passes that a supervisor approved, from today. Everything else is read only.
 */
export function ReviewPanel({ pass, today, contractorName, reasons, decisions, position, onNext, onPrevious, onClose, onDecided, onRevoke, suspendShortcuts }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const busy = decisions.busyOf(pass.id)
  const lock = useReviewLock(pass, busy)

  const expired = today !== null && isExpired(pass, today)
  const decidable = pass.status === 'supervisor_approved' && !expired
  const locked = lock.changed || !decidable
  const revocable = pass.status === 'officer_approved' && !expired && !lock.changed

  const approve = async () => {
    if (locked) return
    const res = await decisions.approve(pass)
    if (res.outcome === 'ok') {
      lock.leave()
      onDecided()
    }
  }

  const confirmReject = async (choice: RejectChoice) => {
    setSending(true)
    setRejectError(null)
    const res = await decisions.reject(pass, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok') {
      lock.leave()
      setRejecting(false)
      onDecided()
    } else if (res.outcome === 'changed') setRejecting(false)
    else setRejectError(res.message ?? strings.common.somethingWrong)
  }

  useReviewShortcuts(!suspendShortcuts && !rejecting && !viewerOpen, {
    next: onNext,
    previous: onPrevious,
    close: onClose,
    approve: () => void approve(),
    reject: () => {
      if (!locked && busy === null) {
        setRejectError(null)
        setRejecting(true)
      }
    },
  })

  return (
    <aside aria-label={t.title} className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-center gap-2 bg-brand px-3 py-2.5 text-on-solid sm:px-4">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">{t.title}</h2>
        {position.index >= 0 && <p className="shrink-0 rounded-full bg-brand-hover px-2.5 py-0.5 text-xs font-semibold tabular-nums">{t.position(position.index + 1, position.total)}</p>}
        <button type="button" aria-label={t.previous} title={t.previous} disabled={position.index <= 0} onClick={onPrevious} className={navButton}><ChevronUp aria-hidden className="size-5" /></button>
        <button type="button" aria-label={t.next} title={t.next} disabled={position.index < 0 || position.index >= position.total - 1} onClick={onNext} className={navButton}><ChevronDown aria-hidden className="size-5" /></button>
        <button type="button" aria-label={t.close} title={t.close} onClick={onClose} className={navButton}><X aria-hidden className="size-5" /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4">
        {lock.changed && <PassChangedBanner onAcknowledge={lock.acknowledge} />}
        {!lock.changed && expired && <NotificationBanner tone="info" role="status">{a.decision.expired}</NotificationBanner>}
        {!lock.changed && !expired && !decidable && <NotificationBanner tone="info" role="status">{t.readOnly}</NotificationBanner>}
        {!lock.changed && decidable && pass.checklist.some((x) => x.answer === 'no') && (
          <NotificationBanner tone="error" role="note">{a.decision.issuesWarning}</NotificationBanner>
        )}
        <PassReview pass={pass} today={today} contractorName={contractorName} {...(today ? { historyHref: vehicleHistoryLink('officer', pass.vehicleId, today) } : {})} layout="wide" onViewerOpenChange={setViewerOpen} />
      </div>

      <footer className="space-y-2 border-t border-slate-200 bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {decidable && (
          <DecisionBar layout="inline" busy={busy} disabled={locked} onApprove={() => void approve()} onReject={() => { setRejectError(null); setRejecting(true) }} className="border-0 p-0" />
        )}
        {revocable && (
          <Button variant="secondary" className="w-full border-danger/40 text-danger-ink hover:bg-danger-soft" icon={<ShieldX aria-hidden className="size-4" />} onClick={() => onRevoke(pass)}>
            {strings.officer.revoke}
          </Button>
        )}
        <p className="hidden items-center gap-2 text-xs text-slate-600 pointer-fine:flex">
          <Keyboard aria-hidden className="size-4" />
          <span className="font-medium">{t.shortcuts}:</span> {t.shortcutsHint}
        </p>
      </footer>

      <RejectSheet open={rejecting} reasons={reasons} loading={sending} error={rejectError} onConfirm={(c) => void confirmReject(c)} onCancel={() => setRejecting(false)} />
    </aside>
  )
}
