// The ONE definition of the pass state machine. Keep src/lib/passTransitions.ts (read-only mirror for UI labels)
// in sync with this file; a unit test compares them.
import type { PassStatus, Role } from './types.js'

export type Stage = 'supervisor' | 'officer' | 'revoked' | 'gate'
export type Action = 'approve' | 'reject' | 'revoke' | 'check_in'

export interface Transition {
  from: PassStatus
  to: PassStatus
  action: Action
  stage: Stage
  /** Roles allowed to make this move. Admin appears only on the revoke move. */
  roles: readonly Role[]
  /** The supervisor is limited to their own contractor. */
  ownContractor: boolean
}

export const TRANSITIONS: readonly Transition[] = [
  { from: 'submitted', to: 'supervisor_approved', action: 'approve', stage: 'supervisor', roles: ['supervisor'], ownContractor: true },
  { from: 'submitted', to: 'rejected', action: 'reject', stage: 'supervisor', roles: ['supervisor'], ownContractor: true },
  { from: 'supervisor_approved', to: 'officer_approved', action: 'approve', stage: 'officer', roles: ['officer'], ownContractor: false },
  { from: 'supervisor_approved', to: 'rejected', action: 'reject', stage: 'officer', roles: ['officer'], ownContractor: false },
  { from: 'officer_approved', to: 'rejected', action: 'revoke', stage: 'revoked', roles: ['officer', 'admin'], ownContractor: false },
  // Module 5: the gate. Security only; admin and officer can never check a vehicle in. There is no check-out.
  { from: 'officer_approved', to: 'checked_in', action: 'check_in', stage: 'gate', roles: ['security'], ownContractor: false },
]

/** The review step a role works at. Admin and everyone else have none: they cannot approve or reject. */
export const reviewStageOf = (role: Role): 'supervisor' | 'officer' | null =>
  role === 'supervisor' ? 'supervisor' : role === 'officer' ? 'officer' : null

/** The status a pass must be in for the given review stage to act on it. */
export const statusForStage = (stage: 'supervisor' | 'officer'): PassStatus =>
  stage === 'supervisor' ? 'submitted' : 'supervisor_approved'

export const findTransition = (from: PassStatus, action: Action, stage: Stage): Transition | undefined =>
  TRANSITIONS.find((t) => t.from === from && t.action === action && t.stage === stage)

export const canTransition = (role: Role, from: PassStatus, action: Action, stage: Stage): boolean =>
  findTransition(from, action, stage)?.roles.includes(role) ?? false
