import type { PassStatus } from '@/types/passes'

/** What the guard sees for a vehicle. One pure function decides it (unit-tested), the view only renders it. */
export type GateResult =
  | { kind: 'approved' }
  /** `pendingSync`: checked in on this phone while offline and not yet confirmed by the server. */
  | { kind: 'already_checked_in'; pendingSync: boolean }
  | { kind: 'pending_supervisor' }
  | { kind: 'pending_officer' }
  | { kind: 'rejected'; reason: string | null }
  | { kind: 'no_pass_today' }
  | { kind: 'vehicle_suspended' }
  | { kind: 'driver_suspended' }
  | { kind: 'contractor_suspended' }
  | { kind: 'not_found' }

export type GateKind = GateResult['kind']

export interface GateInputs {
  /** `null`: the vehicle does not exist or may not be read (both mean "unknown QR code"). */
  vehicle: { status: 'active' | 'suspended' } | null
  /** Today's pass (`{vehicleId}_{today}`), or null when there is none. */
  pass: { status: PassStatus; dateKey: string; rejection?: { reason: string } | undefined } | null
  /** The driver profile named on the pass. `null` when unknown (no pass, or no profile): it then does not block. */
  driver: { status: 'active' | 'disabled' } | null
  /** `null` when unknown: it then does not block (the server checks again). */
  contractor: { status: 'active' | 'suspended' } | null
  /** Today in the tenant timezone. */
  today: string
  /** A check-in for this pass is waiting in this phone's offline queue. */
  pendingSync?: boolean
}

/**
 * Priority, highest first: unknown vehicle; already in (the server says so, or this phone queued it); a suspended
 * vehicle, contractor or driver (blocks even an approved pass); no pass today; then the pass status.
 */
export function computeGateResult(i: GateInputs): GateResult {
  if (!i.vehicle) return { kind: 'not_found' }
  const pass = i.pass && i.pass.dateKey === i.today ? i.pass : null
  if (pass?.status === 'checked_in') return { kind: 'already_checked_in', pendingSync: false }
  if (pass && i.pendingSync) return { kind: 'already_checked_in', pendingSync: true }
  if (i.vehicle.status !== 'active') return { kind: 'vehicle_suspended' }
  if (i.contractor && i.contractor.status !== 'active') return { kind: 'contractor_suspended' }
  if (pass && i.driver && i.driver.status !== 'active') return { kind: 'driver_suspended' }
  if (!pass) return { kind: 'no_pass_today' }
  switch (pass.status) {
    case 'officer_approved':
      return { kind: 'approved' }
    case 'submitted':
      return { kind: 'pending_supervisor' }
    case 'supervisor_approved':
      return { kind: 'pending_officer' }
    case 'rejected':
      return { kind: 'rejected', reason: pass.rejection?.reason ?? null }
  }
}

export type GateTone = 'green' | 'amber' | 'red'

/** Green only for "approved", amber for "already checked in", red for everything that is not approved. */
export const gateTone = (kind: GateKind): GateTone =>
  kind === 'approved' ? 'green' : kind === 'already_checked_in' ? 'amber' : 'red'

/** A vehicle can be checked in only from the green state. */
export const canCheckIn = (r: GateResult): boolean => r.kind === 'approved'

/** "Record denied entry" needs a known vehicle (the server finds it by id). */
export const canDeny = (r: GateResult): boolean => r.kind !== 'not_found'
