import type { Driver, WithId } from '@/types'

/** Only active drivers of the vehicle's contractor can be assigned (the server enforces the same rule). */
export const assignableDrivers = (drivers: WithId<Driver>[], contractorId: string): WithId<Driver>[] =>
  drivers.filter((d) => d.contractorId === contractorId && d.status === 'active')
