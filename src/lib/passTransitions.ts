// Read-only mirror of functions/src/passTransitions.ts, used for UI labels and button visibility only. The server
// decides what is allowed. KEEP IN SYNC with that file (a unit test compares the two tables).
import type { Role } from './roles'
import type { PassStatus } from '@/types/passes'

export type Stage = 'supervisor' | 'officer' | 'revoked' | 'gate'
export type Action = 'approve' | 'reject' | 'revoke' | 'check_in'

export interface Transition {
  from: PassStatus
  to: PassStatus
  action: Action
  stage: Stage
  roles: readonly Role[]
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

/** The review step a role works at. Admin and everyone else have none. */
export const reviewStageOf = (role: Role): 'supervisor' | 'officer' | null =>
  role === 'supervisor' ? 'supervisor' : role === 'officer' ? 'officer' : null

/** The status a pass must be in for the given review stage to act on it. */
export const statusForStage = (stage: 'supervisor' | 'officer'): PassStatus =>
  stage === 'supervisor' ? 'submitted' : 'supervisor_approved'

export const canTransition = (role: Role, from: PassStatus, action: Action, stage: Stage): boolean =>
  TRANSITIONS.some((t) => t.from === from && t.action === action && t.stage === stage && t.roles.includes(role))
