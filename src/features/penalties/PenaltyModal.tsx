import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { revokePenalty, verifyPenalty } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { PENALTY_NOTE_MAX, PENALTY_REASON_MIN } from '@/lib/penaltyLogic'
import { strings } from '@/lib/strings'
import { useNow } from '@/features/passes/useToday'
import { awaitingReview, statusOf, type PenaltyRow } from './model'
import { PenaltyDetails } from './PenaltyDetails'

const t = strings.penalties

interface Props {
  penalty: PenaltyRow | null
  onClose: () => void
  /** `admin` may revoke, `supervisor` may mark as reviewed; everyone else reads. */
  viewer: 'admin' | 'safety' | 'supervisor'
}

/**
 * One penalty in full. Admin: Revoke (only while it is in force). Supervisor: "Mark as reviewed", worded as a confirmation
 * because the penalty already applies; nothing here approves or rejects anything.
 */
export function PenaltyModal({ penalty, onClose, viewer }: Props) {
  return (
    <Modal open={penalty !== null} onClose={onClose} title={penalty ? `${t.detail.title}: ${penalty.typeName}` : t.detail.title} variant="drawer">
      {penalty && <Body key={penalty.id} penalty={penalty} viewer={viewer} onClose={onClose} />}
    </Modal>
  )
}

function Body({ penalty, viewer, onClose }: { penalty: PenaltyRow; viewer: Props['viewer']; onClose: () => void }) {
  const now = useNow()
  const inForce = statusOf(penalty, now) === 'active'
  return (
    <div className="space-y-6">
      <PenaltyDetails penalty={penalty} />
      {viewer === 'supervisor' && awaitingReview(penalty) && <ReviewForm penalty={penalty} onDone={onClose} />}
      {viewer === 'admin' && inForce && <RevokeForm penalty={penalty} onDone={onClose} />}
    </div>
  )
}

function ReviewForm({ penalty, onDone }: { penalty: PenaltyRow; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await verifyPenalty({ penaltyId: penalty.id, ...(note.trim() ? { note: note.trim() } : {}) })
      toast.success(t.verify.done)
      onDone()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t.verify.confirmTitle} className="space-y-3 border-t border-slate-100 pt-5">
      <h3 className="text-sm font-semibold">{t.verify.confirmTitle}</h3>
      <NotificationBanner tone="info">{t.verify.confirmHint}</NotificationBanner>
      <Textarea label={t.verify.note} hint={t.verify.noteHint} value={note} maxLength={PENALTY_NOTE_MAX} optional onChange={(e) => setNote(e.target.value)} />
      <Button className="w-full" loading={busy} onClick={() => void submit()}>
        {t.verify.confirm}
      </Button>
    </section>
  )
}

function RevokeForm({ penalty, onDone }: { penalty: PenaltyRow; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = note.trim().length >= PENALTY_REASON_MIN
  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      await revokePenalty({ penaltyId: penalty.id, note: note.trim() })
      toast.success(t.revoke.done)
      onDone()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t.revoke.action} className="space-y-3 border-t border-slate-100 pt-5">
      {open ? (
        <>
          <h3 className="text-sm font-semibold">{t.revoke.title}</h3>
          <p className="text-sm text-slate-600">{t.revoke.body}</p>
          <Textarea label={t.revoke.note} value={note} maxLength={PENALTY_NOTE_MAX} error={note !== '' && !valid ? t.revoke.noteError : undefined} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setOpen(false)}>
              {strings.common.cancel}
            </Button>
            <Button variant="danger" className="flex-1" disabled={!valid} loading={busy} onClick={() => void submit()}>
              {t.revoke.confirm}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="danger" className="w-full" onClick={() => setOpen(true)}>
          {t.revoke.action}
        </Button>
      )}
    </section>
  )
}
