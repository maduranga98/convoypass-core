import { useState } from 'react'
import { useSensitiveState } from '@/features/platform/sensitive'
import type { Role } from '@/lib/roles'

/** What the card shows. `pin` lives in the caller's component state only and is dropped when the card closes. */
export interface IssuedPin {
  pin: string
  name: string
  role: Role
  company: string
  reissued?: boolean
  /** Shown again on request ("Show PIN"): the warning says every view is recorded. */
  viewed?: boolean
}

/** Holds a one-time PIN in component state only; it is dropped on close, on unmount (navigation) and when the session ends. */
export function useIssuedPin() {
  const [issued, setIssued] = useState<IssuedPin | null>(null)
  useSensitiveState(() => setIssued(null))
  return [issued, setIssued] as const
}

/** `https://wa.me/?text=…`: WhatsApp asks who to send it to. */
export const whatsAppShareLink = (message: string): string => `https://wa.me/?text=${encodeURIComponent(message)}`

