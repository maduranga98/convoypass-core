import { useMemo } from 'react'
import type { Scope } from '@/features/shared/scope'
import { useVehicles } from '@/features/shared/queries'

/** driverId -> plate of the vehicle they are already assigned to (a driver drives one vehicle). `exceptVehicleId` is the one being edited. */
export function useDriverAssignments(scope: Scope, exceptVehicleId?: string): ReadonlyMap<string, string> {
  const vehicles = useVehicles(scope)
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const v of vehicles.data?.items ?? []) {
      if (v.id === exceptVehicleId) continue
      for (const d of v.assignedDriverIds) if (!map.has(d)) map.set(d, v.plateNo)
    }
    return map
  }, [vehicles.data, exceptVehicleId])
}
