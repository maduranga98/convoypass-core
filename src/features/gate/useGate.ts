import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { gatesOf, type GateDef } from '@/lib/gates'
import { useGateChoice } from './deviceSettings'
import { useQueueSync } from './gateQueue'
import { useWakeLock } from './useWakeLock'

export interface GateChoice {
  gates: readonly GateDef[]
  /** The gate this phone stands at: the only one, or the one picked on this device (if it still exists). */
  gate: GateDef | null
  setGate: (id: string) => void
}

export function useGates(): GateChoice {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const gates = gatesOf(tenant.data)
  const [choice, setChoice] = useGateChoice(claims.tenantId)
  const only = gates.length === 1 ? (gates[0] ?? null) : null
  return { gates, gate: only ?? gates.find((g) => g.id === choice) ?? null, setGate: (id) => setChoice(id) }
}

/** What every security screen runs: the offline queue sync loop and the screen wake lock. */
export function useGateRuntime(): void {
  const { uid } = useSession()
  useQueueSync(uid)
  useWakeLock(true)
}
