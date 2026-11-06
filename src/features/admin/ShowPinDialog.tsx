import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { revealPin } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { PinCardModal } from './PinCard'
import { useIssuedPin } from './pinCardState'
import type { ReissueTarget } from './ReissuePinDialog'

/**
 * "Show PIN" for a driver or security user: fetches the current PIN from the server (audited there) and shows the same card
 * as a new PIN. The PIN stays in component state only and is dropped on close. Returns `[show, modal]`.
 */
export function useShowPin(): readonly [(target: ReissueTarget) => Promise<void>, ReactNode] {
  const [issued, setIssued] = useIssuedPin()
  const [busy, setBusy] = useState(false)

  const show = async (target: ReissueTarget) => {
    if (busy) return
    setBusy(true)
    try {
      const { pin } = await revealPin({ uid: target.id })
      setIssued({ pin, name: target.name, role: target.role, company: target.company, viewed: true })
    } catch (e) {
      toast.error(apiErrorReason(e) === 'pin-not-stored' ? strings.reissue.notStored : apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return [show, <PinCardModal key="show-pin" issued={issued} onDone={() => setIssued(null)} />] as const
}
