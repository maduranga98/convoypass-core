// Keep in sync with functions/src/denyReasons.ts (functions deploy from their own folder; a unit test compares them).

export interface DenyReasonDef {
  id: string
  label: string
}

/** The reason that always needs a note. */
export const DENY_OTHER_ID = 'other'
export const MIN_DENY_NOTE = 3
export const MAX_DENY_NOTE = 200

/** Why security turned a vehicle away at the gate. A denial is logged in `gateEvents` and never changes the pass. */
export const DENY_REASONS = [
  { id: 'driver_mismatch', label: 'Driver does not match the photo or pass' },
  { id: 'not_approved', label: 'Vehicle not approved' },
  { id: 'vehicle_condition', label: 'Vehicle condition or safety concern' },
  { id: 'suspended', label: 'Vehicle, driver or contractor suspended' },
  { id: DENY_OTHER_ID, label: 'Other (note required)' },
] as const satisfies readonly DenyReasonDef[]

export type DenyReasonCode = (typeof DENY_REASONS)[number]['id']

export const DENY_REASON_IDS = DENY_REASONS.map((r) => r.id) as [DenyReasonCode, ...DenyReasonCode[]]
