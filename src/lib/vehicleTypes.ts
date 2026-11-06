// Keep in sync with functions/src/vehicleTypes.ts (functions deploy from their own folder).
export const VEHICLE_TYPES = [
  'Bulk Tanker',
  'Tipper',
  'Flatbed',
  'Container Carrier',
  'Lorry',
  'Cement Bulker',
  'Other',
] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const isVehicleType = (v: unknown): v is VehicleType =>
  typeof v === 'string' && (VEHICLE_TYPES as readonly string[]).includes(v)

/** Per-tenant list (`tenants.vehicleTypes`): names, 1-30 of them, unique ignoring case. Falls back to the defaults above. */
export const MAX_VEHICLE_TYPES = 30
export const VEHICLE_TYPE_NAME_MIN = 2
export const VEHICLE_TYPE_NAME_MAX = 40

/** The tenant's list, or the defaults for a tenant that never set one. */
export const effectiveVehicleTypes = (configured: readonly string[] | undefined): string[] =>
  configured && configured.length > 0 ? [...configured] : [...VEHICLE_TYPES]
