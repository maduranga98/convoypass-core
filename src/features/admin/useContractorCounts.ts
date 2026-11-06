import { useMemo } from 'react'
import { useDrivers, useVehicles } from '@/features/shared/queries'

/** Count of records per contractor; derived from the (capped) vehicle and driver lists. */
export function useContractorCounts() {
  const vehicles = useVehicles('admin')
  const drivers = useDrivers('admin')
  return useMemo(() => {
    const v = new Map<string, number>()
    const d = new Map<string, number>()
    for (const x of vehicles.data?.items ?? []) v.set(x.contractorId, (v.get(x.contractorId) ?? 0) + 1)
    for (const x of drivers.data?.items ?? []) d.set(x.contractorId, (d.get(x.contractorId) ?? 0) + 1)
    return { vehicles: v, drivers: d, loading: vehicles.isPending || drivers.isPending }
  }, [vehicles.data, vehicles.isPending, drivers.data, drivers.isPending])
}
