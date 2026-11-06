import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { reissuePin } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import type { Role } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { PinCardModal } from './PinCard'
import { useIssuedPin } from './pinCardState'

const t = strings.reissue

export interface ReissueTarget {
  id: string
  name: string
  role: Role
  company: string
}

/**
 * "Reissue PIN" for a driver or security user (Module 12): confirm ("This signs them out on every phone."), then the new
 * PIN card, shown once. The old PIN stops working at once; the server signs the person out everywhere.
 */
export function ReissuePinDialog({ target, onClose }: { target: ReissueTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useIssuedPin()

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    try {
      const { pin } = await reissuePin({ uid: target.id })
      setIssued({ pin, name: target.name, role: target.role, company: target.company, reissued: true })
      toast.success(t.done)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <>
      <ConfirmDialog
        open={target !== null}
        title={t.title}
        body={target ? t.body(target.name) : ''}
        confirmLabel={t.confirm}
        tone="danger"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={onClose}
      />
      <PinCardModal issued={issued} onDone={() => setIssued(null)} />
    </>
  )
}
