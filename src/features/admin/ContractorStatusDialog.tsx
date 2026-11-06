import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { setContractorStatus } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { Contractor, WithId } from '@/types'

const t = strings.admin.contractors

/** Suspend / activate through `setContractorStatus`. Suspending signs out every user of the contractor. */
export function ContractorStatusDialog({ contractor, onClose }: { contractor: WithId<Contractor> | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const suspending = contractor?.status === 'active'

  const confirm = async () => {
    if (!contractor) return
    setBusy(true)
    try {
      await setContractorStatus({ contractorId: contractor.id, status: suspending ? 'suspended' : 'active' })
      await queryClient.invalidateQueries({ queryKey: ['contractors'] })
      toast.success(suspending ? t.suspended : t.activated)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <ConfirmDialog
      open={contractor !== null}
      title={suspending ? t.suspendTitle : t.activateTitle}
      body={contractor ? (suspending ? t.suspendBody(contractor.name) : t.activateBody(contractor.name)) : ''}
      confirmLabel={suspending ? t.suspend : t.activate}
      tone={suspending ? 'danger' : 'primary'}
      loading={busy}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    />
  )
}
