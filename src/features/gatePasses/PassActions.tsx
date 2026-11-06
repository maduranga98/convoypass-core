import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { apiErrorMessage } from '@/lib/errors'
import { MANUAL_BLOCK_NOTE_MAX, MANUAL_BLOCK_NOTE_MIN } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'
import { isPast, unresolvedCauses, unresolvedText, type PassRow } from './model'
import { useGatePassMutations, useReactivationCheck } from './queries'

const t = strings.gatePasses.actions

/**
 * Reactivate a blocked pass. Never blind: the button is enabled only once the shared eligibility check (documents, penalties,
 * the vehicle's inspection) passes again, and says what is still wrong until then. The server repeats the check on confirm.
 */
export function ReactivateAction({ pass, currentMonth }: { pass: PassRow; currentMonth: string }) {
  const { reactivate } = useGatePassMutations()
  const [open, setOpen] = useState(false)
  const check = useReactivationCheck(pass.vehicleId, pass.driverId, !isPast(pass.month, currentMonth))
  if (isPast(pass.month, currentMonth)) return <span className="text-xs text-slate-500">{t.onlyThisMonth}</span>

  const causes = check.data ? unresolvedCauses(check.data) : []
  const ready = check.data !== undefined && causes.length === 0
  const hint = check.isPending ? strings.gatePasses.cause.checking : check.isError ? strings.gatePasses.cause.couldNotCheck : causes.length > 0 ? unresolvedText(causes) : strings.gatePasses.cause.resolved

  const confirm = () =>
    reactivate.mutate(pass.id, {
      onSuccess: () => {
        toast.success(t.reactivated)
        setOpen(false)
      },
      onError: (e) => {
        toast.error(apiErrorMessage(e))
        setOpen(false)
      },
    })

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" disabled={!ready} onClick={() => setOpen(true)} aria-describedby={`why-${pass.id}`}>
        {t.reactivate}
      </Button>
      <span id={`why-${pass.id}`} className="max-w-56 text-right text-xs text-slate-600">
        {ready ? hint : `${t.waiting}: ${hint}`}
      </span>
      <ConfirmDialog
        open={open}
        title={t.reactivateTitle}
        body={t.reactivateBody(pass.plateNo, pass.driverName)}
        confirmLabel={t.confirmReactivate}
        loading={reactivate.isPending}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}

/** Block an active pass on purpose. A note says why (kept on the pass and in the audit log). */
export function BlockAction({ pass }: { pass: PassRow }) {
  const { block } = useGatePassMutations()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = note.trim()
  const valid = trimmed.length >= MANUAL_BLOCK_NOTE_MIN && trimmed.length <= MANUAL_BLOCK_NOTE_MAX

  const close = () => {
    setOpen(false)
    setNote('')
    setTouched(false)
  }
  const submit = () => {
    setTouched(true)
    if (!valid) return
    block.mutate(
      { passId: pass.id, note: trimmed },
      {
        onSuccess: () => {
          toast.success(t.blocked)
          close()
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    )
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t.block}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t.blockTitle}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={block.isPending}>
              {strings.common.cancel}
            </Button>
            <Button variant="danger" onClick={submit} loading={block.isPending}>
              {t.confirmBlock}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t.blockBody(pass.plateNo, pass.driverName)}</p>
          <Textarea
            label={t.noteLabel}
            hint={t.noteHint}
            value={note}
            maxLength={MANUAL_BLOCK_NOTE_MAX}
            rows={3}
            error={touched && !valid ? t.noteError : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
