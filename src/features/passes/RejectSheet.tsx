import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { MAX_REASON_NOTE, MIN_REASON_NOTE, OTHER_REASON_ID, type RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import { strings } from '@/lib/strings'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.approvals.reject

export interface RejectChoice {
  reasonCode: string
  note?: string
}

interface Props {
  open: boolean
  /** `revoke` cancels an approval that was already given. */
  mode?: 'reject' | 'revoke'
  reasons: readonly RejectionReasonDef[]
  /** Disables the form while the call is in flight. */
  loading?: boolean
  /** A failure from the last attempt. */
  error?: string | null
  onConfirm: (choice: RejectChoice) => void
  onCancel: () => void
}

/**
 * Pick one reason (chips), add a note (required for "other"), confirm. A bottom sheet on mobile, a dialog from `sm`
 * up. The server checks the reason and the note again.
 */
export function RejectSheet({ open, mode = 'reject', reasons, loading = false, error = null, onConfirm, onCancel }: Props) {
  const [code, setCode] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const groupId = useId()
  const noteId = useId()

  // Every time the sheet opens it starts empty.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setCode(null)
      setNote('')
      setTried(false)
    }
  }

  const noteRequired = code === OTHER_REASON_ID
  const trimmed = note.trim()
  const noteMissing = noteRequired && trimmed.length < MIN_REASON_NOTE
  const revoke = mode === 'revoke'

  const submit = () => {
    setTried(true)
    if (loading || !code || noteMissing) return
    onConfirm({ reasonCode: code, ...(trimmed ? { note: trimmed } : {}) })
  }

  return (
    <Modal
      open={open}
      onClose={() => !loading && onCancel()}
      title={revoke ? t.revokeTitle : t.rejectTitle}
      variant="sheet"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="h-12 sm:h-11" disabled={loading} onClick={onCancel}>
            {strings.common.cancel}
          </Button>
          <Button variant="danger" className="h-12 sm:h-11" loading={loading} onClick={submit}>
            {revoke ? t.confirmRevoke : t.confirmReject}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-700">{revoke ? t.revokeIntro : t.rejectIntro}</p>

        <fieldset disabled={loading} className="space-y-2">
          <legend className="text-sm font-semibold text-ink">{t.reasonLegend}</legend>
          <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
            <span id={groupId} className="sr-only">{t.reasonLegend}</span>
            {reasons.map((r) => (
              <label
                key={r.id}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 py-2 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  code === r.id ? 'border-danger-strong bg-danger-soft text-danger-ink' : 'border-slate-300 bg-surface text-slate-800 hover:bg-slate-50',
                )}
              >
                <input type="radio" name={groupId} value={r.id} checked={code === r.id} onChange={() => setCode(r.id)} className="sr-only" />
                {r.label}
              </label>
            ))}
          </div>
          {tried && !code && <p role="alert" className="text-sm text-danger-strong">{t.pickReason}</p>}
        </fieldset>

        {code && (
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-sm font-semibold text-ink">
              {noteRequired ? t.noteRequired : t.noteOptional}
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={MAX_REASON_NOTE}
              rows={3}
              disabled={loading}
              placeholder={t.notePlaceholder}
              aria-invalid={tried && noteMissing ? true : undefined}
              aria-describedby={tried && noteMissing ? `${noteId}-err` : undefined}
              onChange={(e) => setNote(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-focus"
            />
            {tried && noteMissing && <p id={`${noteId}-err`} role="alert" className="text-sm text-danger-strong">{t.noteError}</p>}
          </div>
        )}

        {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      </div>
    </Modal>
  )
}
