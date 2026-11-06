// In-memory WorkspacePort + Auth for the Module 10 tests. Not part of the build (see tsconfig.json).
import { buildTenantDocs, type ProvisionInput } from '../tenants/tenantDefaults.js'
import { generateTempPassword } from '../auth/tempPassword.js'
import type { AuditEntry } from '../types.js'
import { supportedTimezones } from '../setup.js'
import { fake, type Fake } from './platform-test-utils.js'
import { createWorkspaceApi, type AdminRecord, type WorkspaceApi, type WorkspaceAuthPort, type WorkspacePort } from './workspaces.js'

export interface UserRow { tenantId: string; role: string; name: string; email: string; status: 'active' | 'disabled'; mustChangePassword: boolean; createdAtMs: number; createdBy: string }
export interface AuthRow { email: string; password: string; disabled: boolean; displayName: string; claims?: unknown }

export interface WsFake extends Fake {
  ws: WorkspaceApi
  wsPort: WorkspacePort
  tenantDocs: Map<string, Record<string, unknown>>
  users: Map<string, UserRow>
  authUsers: Map<string, AuthRow>
  tenantAudits: AuditEntry[]
  revoked: string[]
  signIns: Map<string, number | null>
  operatorEmails: Set<string>
  /** Make a step fail once. */
  failures: { claims?: boolean; commit?: boolean; authUpdate?: boolean; createUser?: 'exists' | 'boom' }
  nextTenantIds: string[]
  nextPasswords: string[]
}

export function wsFake(opts: { limited?: boolean } = {}): WsFake {
  const f = fake({ appBaseUrl: 'https://app.convoypass.test' }, opts)
  const tenantDocs = new Map<string, Record<string, unknown>>()
  const users = new Map<string, UserRow>()
  const authUsers = new Map<string, AuthRow>()
  const tenantAudits: AuditEntry[] = []
  const revoked: string[] = []
  const signIns = new Map<string, number | null>()
  const operatorEmails = new Set<string>([f.operators.get('op1')!.email])
  const failures: WsFake['failures'] = {}
  const nextTenantIds: string[] = []
  const nextPasswords: string[] = []
  let n = 0

  const auth: WorkspaceAuthPort = {
    getUserByEmail: async (email) => {
      const hit = [...authUsers.entries()].find(([, u]) => u.email === email)
      return hit ? { uid: hit[0] } : null
    },
    createUser: async (p) => {
      if (failures.createUser === 'exists') throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' })
      if (failures.createUser === 'boom') throw new Error('auth down')
      const uid = `u${++n}`
      authUsers.set(uid, { email: p.email, password: p.password, disabled: false, displayName: p.displayName })
      return { uid }
    },
    setCustomUserClaims: async (uid, claims) => {
      if (failures.claims) throw new Error('claims boom')
      authUsers.get(uid)!.claims = claims
    },
    deleteUser: async (uid) => void authUsers.delete(uid),
    updateUser: async (uid, p) => {
      if (failures.authUpdate) throw new Error('auth update boom')
      authUsers.set(uid, { ...authUsers.get(uid)!, ...(p.password !== undefined ? { password: p.password } : {}), ...(p.disabled !== undefined ? { disabled: p.disabled } : {}), ...(p.displayName !== undefined ? { displayName: p.displayName } : {}) })
    },
    revokeRefreshTokens: async (uid) => void revoked.push(uid),
    lastSignIn: async (uids) => new Map(uids.map((u) => [u, signIns.get(u) ?? null])),
  }

  const adminsOf = (tenantId: string) => [...users.entries()].filter(([, u]) => u.tenantId === tenantId && u.role === 'admin')

  const workspaces: WorkspacePort = {
    emailInUse: async (email) => operatorEmails.has(email) || [...users.values()].some((u) => u.email === email),
    getWorkspace: async (tenantId) => {
      const t = tenantDocs.get(tenantId)
      if (!t) return null
      return {
        name: String(t.name), createdAtMs: 1000, timezone: String(t.timezone),
        userCount: [...users.values()].filter((u) => u.tenantId === tenantId).length, vehicleCount: 0,
      }
    },
    listAdmins: async (tenantId) =>
      adminsOf(tenantId).map(([uid, u]): AdminRecord => ({ uid, name: u.name, email: u.email, status: u.status, mustChangePassword: u.mustChangePassword, createdAtMs: u.createdAtMs })),
    getUser: async (uid) => users.get(uid) ?? null,
    createWorkspace: async ({ input, platformAudit }) => {
      if (failures.commit) throw new Error('commit boom') // nothing is written: one transaction
      if (tenantDocs.has(input.tenantId) || users.has(input.admin.uid)) throw new Error('already exists')
      const docs = buildTenantDocs({ ...input, createdAt: { stamp: true } } as ProvisionInput)
      tenantDocs.set(input.tenantId, docs.tenant)
      users.set(input.admin.uid, { tenantId: input.tenantId, role: 'admin', name: input.admin.name, email: input.admin.email, status: 'active', mustChangePassword: input.admin.mustChangePassword, createdAtMs: ++n, createdBy: input.admin.createdBy })
      tenantAudits.push(...(docs.audits as unknown as AuditEntry[]))
      f.audits.push(platformAudit)
    },
    addAdmin: async ({ tenantId, uid, name, email, tenantAudit, platformAudit }) => {
      if (failures.commit) throw new Error('commit boom')
      users.set(uid, { tenantId, role: 'admin', name, email, status: 'active', mustChangePassword: true, createdAtMs: ++n, createdBy: 'platform' })
      tenantAudits.push(tenantAudit)
      f.audits.push(platformAudit)
    },
    resetAdmin: async ({ uid, tenantAudit, platformAudit }) => {
      users.get(uid)!.mustChangePassword = true
      tenantAudits.push(tenantAudit)
      f.audits.push(platformAudit)
    },
    renameAdmin: async ({ uid, name, tenantAudit, platformAudit }) => {
      users.get(uid)!.name = name
      tenantAudits.push(tenantAudit)
      f.audits.push(platformAudit)
    },
    setAdminStatus: async ({ tenantId, uid, status, tenantAudit, platformAudit }) => {
      if (status === 'disabled' && !adminsOf(tenantId).some(([id, u]) => id !== uid && u.status === 'active')) return 'last-admin'
      users.get(uid)!.status = status
      tenantAudits.push(tenantAudit)
      f.audits.push(platformAudit)
      return 'ok'
    },
    restoreAdminStatus: async (uid, status) => void (users.get(uid)!.status = status),
  }

  const ws = createWorkspaceApi({
    ...f.deps,
    auth,
    workspaces,
    newTenantId: () => nextTenantIds.shift() ?? `ten_${String(++n).padStart(10, 'a')}`,
    newTempPassword: () => nextPasswords.shift() ?? generateTempPassword(),
    timezones: supportedTimezones,
  })
  return { ...f, ws, wsPort: workspaces, tenantDocs, users, authUsers, tenantAudits, revoked, signIns, operatorEmails, failures, nextTenantIds, nextPasswords }
}
