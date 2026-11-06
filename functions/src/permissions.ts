// The permissions matrix: ONE table of role -> allowed actions. Mirrors src/lib/permissions.ts in the web app
// (functions deploy from this folder only; src/lib/permissions.test.ts fails if the copies differ). Pure: no firebase
// imports. Documented, with scope notes, in docs/permissions.md.
//
// This matrix covers auth and roles (Module 1 of the foundation). Actions of later modules (inspections, penalties,
// trips, ...) are added to the same table when those modules are built, never as scattered role checks.
import type { Role } from './types.js'

/** The Super admin is not a tenant role (it has no tenant); it is listed here so the matrix shows the whole hierarchy. */
export type Principal = Role | 'superadmin'

const ALL_STAFF = ['admin', 'officer', 'supervisor', 'safety'] as const

export const PERMISSIONS = {
  // Platform level: scripts and the /platform console only. A tenant role can never hold these.
  'workspace.create': ['superadmin'],
  'workspace.admin.manage': ['superadmin'],
  // Accounts. Admins are created, reset, disabled by the Super admin only (nobody manages themselves).
  'user.create.admin': ['superadmin'],
  'user.create.officer': ['admin'],
  'user.create.supervisor': ['admin'],
  'user.create.safety': ['admin'],
  'user.create.security': ['admin'],
  'user.create.yard': ['admin'],
  'user.create.driver': ['admin', 'supervisor'],
  'user.manage': ['admin', 'supervisor'],
  'user.pin.reissue': ['admin', 'supervisor'],
  // View a driver's or guard's current PIN (sealed copy; accounts issued before this existed must be reissued).
  'user.pin.view': ['admin', 'supervisor'],
  // Vehicle and driver records (Module 2). Supervisors manage their own contractor's only; the Safety Officer reads.
  'vehicle.view': ['admin', 'officer', 'supervisor', 'safety', 'security'],
  'vehicle.manage': ['admin', 'supervisor'],
  // Suspending or re-activating a vehicle is the Company Admin's call; a supervisor edits records but cannot take a vehicle off the road.
  'vehicle.setStatus': ['admin'],
  'driver.view': ['admin', 'officer', 'supervisor', 'safety', 'security'],
  'vehicleType.manage': ['admin'],
  'expiry.settings': ['admin'],
  // Driver qualifications (safety, defensive driving, work instruction, ...; valid one year). Admin and Officer record them;
  // the Admin edits the list of required types (`settings.manage`). Without every required one a driver is not eligible.
  'qualification.record': ['admin', 'officer'],
  // A driver enters their own permit numbers (1-2, valid three months). Information only.
  'permit.set': ['driver'],
  // Penalties and suspensions. Admin and Safety Officer issue (a penalty takes effect at once); only an admin revokes;
  // a supervisor confirms, after the fact, penalties against their own contractor and reads those only.
  'penalty.view': ['admin', 'safety', 'supervisor'],
  'penalty.issue': ['admin', 'safety'],
  'penalty.revoke': ['admin'],
  'penalty.verify': ['supervisor'],
  'penaltyType.view': ['admin', 'safety', 'supervisor'],
  'penaltyType.manage': ['admin'],
  // The live eligibility check (documents + penalties). Security calls it at the gate; supervisors only for their own contractor.
  'eligibility.check': ['admin', 'officer', 'supervisor', 'safety', 'security'],
  // Inspections and trip clearance. Only the Safety Officer records or withdraws a clearance; the admin has oversight
  // (read only) and a supervisor reads their own contractor's. Security and drivers never read inspections: the gate
  // consumes the combined `checkEligibility` output.
  'inspection.view': ['admin', 'safety', 'supervisor'],
  'inspection.record': ['safety'],
  'inspection.withdraw': ['safety'],
  // Monthly gate pass (the last gate of the eligibility chain, after documents, penalties and the inspection). The Company Admin
  // issues, blocks and reactivates passes, reviews the month-end qualification list and owns the auto-issue setting. The
  // supervisor (own contractor) and the Safety Officer read pass status only. Security never reads passes: the check-in function
  // consumes them. Drivers and the Yard Officer have no access. A system block (penalty, expired document, cancelled inspection)
  // is done by triggers, never by a role.
  'gatePass.view': ['admin', 'safety', 'supervisor'],
  'gatePass.issue': ['admin'],
  'gatePass.block': ['admin'],
  'gatePass.reactivate': ['admin'],
  'gatePass.qualification.view': ['admin'],
  'gatePass.qualification.refresh': ['admin'],
  'gatePass.autoIssue.manage': ['admin'],
  // Visit lifecycle: one record per vehicle visit (check-in, unloading check, check-out). Only Security records the gate
  // stages and only the Yard Officer records the unloading check, each on its own part of the visit. Everyone else reads.
  // Supervisors read their own contractor's visits only. Eligibility is consumed from `eligibility.check`, never decided here.
  'visit.view': ['admin', 'officer', 'supervisor', 'safety', 'security', 'yard'],
  'visit.checkIn': ['security'],
  'visit.checkOut': ['security'],
  'visit.unloadingCheck': ['yard'],
  'visit.summary': ['admin', 'officer', 'supervisor', 'safety', 'security', 'yard'],
  // Own account.
  'account.view': ['admin', 'officer', 'supervisor', 'safety', 'security', 'yard', 'driver'],
  'account.password.change': [...ALL_STAFF],
  // Workspace setup (Company Admin).
  'contractor.manage': ['admin'],
  'settings.manage': ['admin'],
  'audit.view': ['admin'],
  // Areas (route guards): who may open each role's home.
  'area.admin': ['admin'],
  'area.officer': ['officer'],
  'area.supervisor': ['supervisor'],
  'area.safety': ['safety'],
  'area.security': ['security'],
  'area.yard': ['yard'],
  'area.driver': ['driver'],
} as const satisfies Record<string, readonly Principal[]>

export type Action = keyof typeof PERMISSIONS

export const ACTIONS = Object.keys(PERMISSIONS) as Action[]

export function can(principal: Principal | null | undefined, action: Action): boolean {
  return principal != null && (PERMISSIONS[action] as readonly Principal[]).includes(principal)
}

/** Tenant roles allowed to do `action` (for route guards). The Super admin is not a tenant role and is left out. */
export function rolesFor(action: Action): Role[] {
  return (PERMISSIONS[action] as readonly Principal[]).filter((p): p is Role => p !== 'superadmin')
}

/** May `caller` create an account with role `target`? Scope (own contractor, same tenant) is checked by the caller. */
export function canCreateRole(caller: Principal, target: Role): boolean {
  return can(caller, `user.create.${target}` as Action)
}
