import type { Driver, Vehicle, WithId } from '@/types'

export type AttentionReason = 'no-driver' | 'rejected'

/** Active drivers currently assigned to the vehicle. */
export const activeDriversOf = (vehicle: Pick<Vehicle, 'assignedDriverIds'>, drivers: ReadonlyMap<string, Pick<Driver, 'status'>>): string[] =>
  vehicle.assignedDriverIds.filter((id) => drivers.get(id)?.status === 'active')

/**
 * Why an active vehicle needs the supervisor's attention: no active driver left (changed or disabled), or today's pass was
 * rejected (the driver or the vehicle may need to change). Suspended vehicles never need it.
 */
export function attentionReasons(
  vehicle: WithId<Pick<Vehicle, 'assignedDriverIds' | 'status'>>,
  drivers: ReadonlyMap<string, Pick<Driver, 'status'>>,
  rejectedVehicleIds: ReadonlySet<string>,
): AttentionReason[] {
  if (vehicle.status !== 'active') return []
  const out: AttentionReason[] = []
  if (activeDriversOf(vehicle, drivers).length === 0) out.push('no-driver')
  if (rejectedVehicleIds.has(vehicle.id)) out.push('rejected')
  return out
}
