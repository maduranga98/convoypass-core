// Module 10: the super admin creates company workspaces and manages their admins. Admin accounts are never created or
// changed by tenant admins any more (`core.ts`); this is the only path.
//   createWorkspace / addTenantAdmin            tenant (via `provisionTenant`) or extra admin, temporary password returned ONCE
//   resetTenantAdminCredential                  new temporary password, change forced, sessions revoked
//   setTenantAdminStatus / updateTenantAdmin    disable/enable (never the last active admin), rename
//   getWorkspace                                tenant summary + its admins; nothing else
// Every mutation writes `platformAuditLog` AND the tenant's `auditLog` (actorRole `superadmin`). The temporary password
// exists only in the response: not stored, logged or audited. No business data (passes, vehicles, drivers, photos) is read.
import { HttpsError } from 'firebase-functions/v2/https'
import { parse } from '../core.js'
import { sanitiseMeta } from '../auditMeta.js'
import { fail } from '../errors.js'
import { logError } from '../logger.js'
import {
  addTenantAdminSchema, createWorkspaceSchema, getWorkspaceSchema, setTenantAdminStatusSchema, tenantAdminTargetSchema,
  updateTenantAdminSchema,
} from '../schemas.js'
import type { AuditEntry } from '../types.js'
import { DEFAULT_TIMEZONE, type ProvisionInput } from '../tenants/tenantDefaults.js'
import type { AuthLike, OperatorCaller } from './operatorGuard.js'
import { makeGuard, type PlatformDeps } from './platform.js'
import { platformAudit, type PlatformAction, type PlatformAuditEntry } from './platformAudit.js'

export const SUPER_ADMIN_ACTOR_NAME = 'ConvoyPass Super Admin'

export interface AdminRecord {
  uid: string
  name: string
  email: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  createdAtMs: number
}

export interface WorkspaceSummary {
  name: string
  createdAtMs: number
  timezone: string
  userCount: number
  vehicleCount: number
}

export interface WorkspaceAuthPort {
  getUserByEmail(email: string): Promise<{ uid: string } | null>
  createUser(p: { email: string; password: string; displayName: string }): Promise<{ uid: string }>
  setCustomUserClaims(uid: string, claims: { role: 'admin'; tenantId: string }): Promise<void>
  deleteUser(uid: string): Promise<void>
  updateUser(uid: string, p: { password?: string; displayName?: string; disabled?: boolean }): Promise<void>
  revokeRefreshTokens(uid: string): Promise<void>
  /** Last sign-in time per uid; `null` = never signed in (a user who only exists has no sign-in yet). */
  lastSignIn(uids: string[]): Promise<Map<string, number | null>>
}

export type StatusOutcome = 'ok' | 'last-admin'

export interface WorkspacePort {
  /** An operator or any tenant user already has this email (the Auth check is separate). */
  emailInUse(email: string): Promise<boolean>
  getWorkspace(tenantId: string): Promise<WorkspaceSummary | null>
  listAdmins(tenantId: string): Promise<AdminRecord[]>
  getUser(uid: string): Promise<{ tenantId: string; role: string; name: string; status: string } | null>
  /** ONE transaction: `provisionTenant` (tenant, admin `users` doc, tenant audit entries) + the platform audit entry. */
  createWorkspace(p: { input: Omit<ProvisionInput, 'createdAt'>; platformAudit: PlatformAuditEntry }): Promise<void>
  /** ONE batch: the admin `users` doc (`createdBy: 'platform'`, `mustChangePassword: true`) + both audit entries. */
  addAdmin(p: { tenantId: string; uid: string; name: string; email: string; tenantAudit: AuditEntry; platformAudit: PlatformAuditEntry }): Promise<void>
  /** Sets `mustChangePassword: true` + both audit entries. */
  resetAdmin(p: { uid: string; tenantAudit: AuditEntry; platformAudit: PlatformAuditEntry }): Promise<void>
  renameAdmin(p: { uid: string; name: string; tenantAudit: AuditEntry; platformAudit: PlatformAuditEntry }): Promise<void>
  /** ONE transaction: refuses to disable the last active admin of the tenant; otherwise sets the status + both audit entries. */
  setAdminStatus(p: { tenantId: string; uid: string; status: 'active' | 'disabled'; tenantAudit: AuditEntry; platformAudit: PlatformAuditEntry }): Promise<StatusOutcome>
  /** Puts a status back without an audit entry (compensation when the Auth update fails after the document changed). */
  restoreAdminStatus(uid: string, status: 'active' | 'disabled'): Promise<void>
}

export interface WorkspaceDeps extends PlatformDeps {
  auth: WorkspaceAuthPort
  workspaces: WorkspacePort
  newTenantId: () => string
  newTempPassword: () => string
  timezones: () => ReadonlySet<string>
}

export interface WorkspaceCredentials {
  tenantId: string
  adminUid: string
  loginUrl: string
  /** Shown once. Never stored, logged or audited. */
  tempPassword: string
}

const errorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined

/**
 * The target must be an admin of THIS tenant. A user of another tenant, a non-admin and a missing user all look the same
 * (`user-not-found`), so the call cannot be used to probe other workspaces. Used by reset, status and update.
 */
export async function assertTargetIsTenantAdmin(port: Pick<WorkspacePort, 'getWorkspace' | 'getUser'>, tenantId: string, uid: string) {
  if (!(await port.getWorkspace(tenantId))) throw fail('not-found', 'workspace-not-found', 'Workspace not found')
  const user = await port.getUser(uid)
  if (!user || user.tenantId !== tenantId || user.role !== 'admin') throw fail('not-found', 'user-not-found', 'Admin not found')
  return user
}

const tenantAudit = (op: OperatorCaller, action: string, tenantId: string, targetId: string, meta: AuditEntry['meta'] = {}): AuditEntry => ({
  tenantId, action, actorUid: op.uid, actorRole: 'superadmin', actorName: SUPER_ADMIN_ACTOR_NAME, targetType: 'user', targetId,
  meta: sanitiseMeta({ ...meta, source: 'platform' }),
})

export function createWorkspaceApi(deps: WorkspaceDeps) {
  const guarded = makeGuard(deps)
  const loginUrl = (): string => {
    let u: URL
    try {
      u = new URL(deps.appBaseUrl)
    } catch {
      throw fail('failed-precondition', 'config-missing', 'The app address is not configured')
    }
    if (u.protocol !== 'https:' && !(deps.inEmulator && u.protocol === 'http:')) throw fail('failed-precondition', 'config-missing', 'The app address is not configured')
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}/login/staff`
  }

  /** Any account with this email (Auth user, operator, tenant user) blocks creation. */
  const assertEmailFree = async (email: string) => {
    if ((await deps.auth.getUserByEmail(email)) || (await deps.workspaces.emailInUse(email))) {
      throw fail('already-exists', 'email-exists', 'An account with this email already exists')
    }
  }

  /** Auth user + claims, then `commit`; any failure after the Auth user exists deletes it (nothing is left behind). */
  const createAdminAccount = async (p: { tenantId: string; name: string; email: string; fn: string; commit: (uid: string) => Promise<void> }) => {
    const tempPassword = deps.newTempPassword()
    let uid: string
    try {
      ;({ uid } = await deps.auth.createUser({ email: p.email, password: tempPassword, displayName: p.name }))
    } catch (e) {
      if (errorCode(e) === 'auth/email-already-exists') throw fail('already-exists', 'email-exists', 'An account with this email already exists')
      logError({ fn: p.fn }, e)
      throw fail('internal', 'internal', 'Could not create the account')
    }
    try {
      await deps.auth.setCustomUserClaims(uid, { role: 'admin', tenantId: p.tenantId })
      await p.commit(uid)
    } catch (e) {
      await deps.auth.deleteUser(uid).catch(() => undefined)
      logError({ fn: p.fn }, e)
      throw fail('internal', 'internal', 'Could not create the account')
    }
    return { uid, tempPassword }
  }

  return {
    async createWorkspace(auth: AuthLike | undefined, raw: unknown): Promise<WorkspaceCredentials> {
      return guarded(auth, 'createWorkspace', true, async (op) => {
        const input = parse(createWorkspaceSchema, raw)
        const timezone = input.timezone || DEFAULT_TIMEZONE
        if (!deps.timezones().has(timezone)) throw fail('invalid-argument', 'timezone-invalid', 'Unknown timezone')
        const base = loginUrl()
        await assertEmailFree(input.adminEmail)
        const tenantId = deps.newTenantId()
        const { uid, tempPassword } = await createAdminAccount({
          tenantId, name: input.adminName, email: input.adminEmail, fn: 'createWorkspace',
          commit: (adminUid) =>
            deps.workspaces.createWorkspace({
              input: {
                tenantId, tenantName: input.companyName, timezone,
                admin: { uid: adminUid, name: input.adminName, email: input.adminEmail, mustChangePassword: true, createdBy: 'platform' },
                actor: { uid: op.uid, role: 'superadmin', name: SUPER_ADMIN_ACTOR_NAME },
                meta: { source: 'platform' },
              },
              platformAudit: platformAudit(op.uid, 'workspace.created', tenantId, { timezone }),
            }),
        })
        return { tenantId, adminUid: uid, loginUrl: base, tempPassword }
      })
    },

    async addTenantAdmin(auth: AuthLike | undefined, raw: unknown): Promise<WorkspaceCredentials> {
      return guarded(auth, 'addTenantAdmin', true, async (op) => {
        const input = parse(addTenantAdminSchema, raw)
        const base = loginUrl()
        if (!(await deps.workspaces.getWorkspace(input.tenantId))) throw fail('not-found', 'workspace-not-found', 'Workspace not found')
        await assertEmailFree(input.email)
        const { uid, tempPassword } = await createAdminAccount({
          tenantId: input.tenantId, name: input.name, email: input.email, fn: 'addTenantAdmin',
          commit: (adminUid) =>
            deps.workspaces.addAdmin({
              tenantId: input.tenantId, uid: adminUid, name: input.name, email: input.email,
              tenantAudit: tenantAudit(op, 'user.create', input.tenantId, adminUid, { role: 'admin' }),
              platformAudit: platformAudit(op.uid, 'admin.created', input.tenantId, {}),
            }),
        })
        return { tenantId: input.tenantId, adminUid: uid, loginUrl: base, tempPassword }
      })
    },

    async resetTenantAdminCredential(auth: AuthLike | undefined, raw: unknown): Promise<WorkspaceCredentials> {
      return guarded(auth, 'resetTenantAdminCredential', true, async (op) => {
        const { tenantId, uid } = parse(tenantAdminTargetSchema, raw)
        const base = loginUrl()
        await assertTargetIsTenantAdmin(deps.workspaces, tenantId, uid)
        const tempPassword = deps.newTempPassword()
        try {
          // Flag first (like `resetCredential`): if the Auth update fails the admin is only asked to change a still-valid password.
          await deps.workspaces.resetAdmin({
            uid,
            tenantAudit: tenantAudit(op, 'user.resetCredential', tenantId, uid),
            platformAudit: platformAudit(op.uid, 'admin.credentialReset', tenantId, {}),
          })
          await deps.auth.updateUser(uid, { password: tempPassword })
          await deps.auth.revokeRefreshTokens(uid)
        } catch (e) {
          logError({ fn: 'resetTenantAdminCredential' }, e)
          throw fail('internal', 'internal', 'Could not reset the credential')
        }
        return { tenantId, adminUid: uid, loginUrl: base, tempPassword }
      })
    },

    async setTenantAdminStatus(auth: AuthLike | undefined, raw: unknown): Promise<{ ok: true }> {
      return guarded(auth, 'setTenantAdminStatus', true, async (op) => {
        const { tenantId, uid, status } = parse(setTenantAdminStatusSchema, raw)
        const target = await assertTargetIsTenantAdmin(deps.workspaces, tenantId, uid)
        if (target.status === status) return { ok: true as const }
        const action: PlatformAction = status === 'disabled' ? 'admin.disabled' : 'admin.enabled'
        const entries = {
          tenantAudit: tenantAudit(op, status === 'disabled' ? 'user.disable' : 'user.enable', tenantId, uid),
          platformAudit: platformAudit(op.uid, action, tenantId, {}),
        }
        try {
          if (status === 'active') {
            await deps.auth.updateUser(uid, { disabled: false })
            await deps.workspaces.setAdminStatus({ tenantId, uid, status, ...entries })
          } else {
            // Document first: it holds the "never the last active admin" check (inside a transaction).
            if ((await deps.workspaces.setAdminStatus({ tenantId, uid, status, ...entries })) === 'last-admin') {
              throw fail('failed-precondition', 'last-admin', 'A workspace must keep at least one active admin. Add another admin first.')
            }
            try {
              await deps.auth.updateUser(uid, { disabled: true })
              await deps.auth.revokeRefreshTokens(uid)
            } catch (e) {
              await deps.workspaces.restoreAdminStatus(uid, 'active').catch(() => undefined)
              throw e
            }
          }
        } catch (e) {
          if (e instanceof HttpsError) throw e // our typed refusal
          logError({ fn: 'setTenantAdminStatus' }, e)
          throw fail('internal', 'internal', 'Could not change the status')
        }
        return { ok: true as const }
      })
    },

    async updateTenantAdmin(auth: AuthLike | undefined, raw: unknown): Promise<{ ok: true }> {
      return guarded(auth, 'updateTenantAdmin', true, async (op) => {
        const { tenantId, uid, name } = parse(updateTenantAdminSchema, raw)
        const target = await assertTargetIsTenantAdmin(deps.workspaces, tenantId, uid)
        if (target.name === name) return { ok: true as const }
        try {
          await deps.auth.updateUser(uid, { displayName: name })
          await deps.workspaces.renameAdmin({
            uid, name,
            tenantAudit: tenantAudit(op, 'user.update', tenantId, uid, { name: true }),
            platformAudit: platformAudit(op.uid, 'admin.updated', tenantId, {}),
          })
        } catch (e) {
          logError({ fn: 'updateTenantAdmin' }, e)
          throw fail('internal', 'internal', 'Could not update the admin')
        }
        return { ok: true as const }
      })
    },

    async getWorkspace(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'getWorkspace', false, async () => {
        const { tenantId } = parse(getWorkspaceSchema, raw)
        const ws = await deps.workspaces.getWorkspace(tenantId)
        if (!ws) throw fail('not-found', 'workspace-not-found', 'Workspace not found')
        const admins = await deps.workspaces.listAdmins(tenantId)
        const signIns = await deps.auth.lastSignIn(admins.map((a) => a.uid))
        // Rebuilt field by field: only these members can ever reach the response.
        return {
          tenant: { tenantId, name: ws.name, createdAt: ws.createdAtMs, timezone: ws.timezone, userCount: ws.userCount, vehicleCount: ws.vehicleCount },
          admins: admins.map((a) => ({
            uid: a.uid, name: a.name, email: a.email, status: a.status, mustChangePassword: a.mustChangePassword,
            createdAt: a.createdAtMs, lastSignInAt: signIns.get(a.uid) ?? null,
          })),
        }
      })
    },
  }
}

export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>
