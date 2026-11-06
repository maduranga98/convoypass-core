import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { db } from '@/lib/firebase'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'

const RECENT = 20

export interface VehicleVisits {
  /** Newest first. */
  items: WithId<Visit>[]
  status: 'loading' | 'ready' | 'error'
}

/**
 * The latest gate visits (one per in and its out) of a vehicle, live. Equality filters on tenant and vehicle plus the
 * check-in time, which the existing `visits` index serves. Unsubscribes with the screen.
 */
export function useVehicleVisits(vehicleId: string | null): VehicleVisits {
  const { claims } = useSession()
  const [state, setState] = useState<{ key: string | null; value: VehicleVisits }>({ key: null, value: { items: [], status: 'loading' } })
  const key = vehicleId === null ? null : `${claims.tenantId}/${vehicleId}`

  useEffect(() => {
    if (vehicleId === null || key === null) return
    return onSnapshot(
      query(collection(db, 'visits'), where('tenantId', '==', claims.tenantId), where('vehicleId', '==', vehicleId), orderBy('checkIn.timestamp', 'desc'), limit(RECENT)),
      (snap) => setState({ key, value: { items: snap.docs.map((d) => ({ ...(d.data() as Visit), id: d.id })), status: 'ready' } }),
      () => setState({ key, value: { items: [], status: 'error' } }),
    )
  }, [claims.tenantId, vehicleId, key])

  return key !== null && state.key === key ? state.value : { items: [], status: 'loading' }
}
