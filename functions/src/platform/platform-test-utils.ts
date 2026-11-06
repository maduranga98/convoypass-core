// In-memory PlatformPort + operator tokens for the Module 9 tests. Not part of the build (see tsconfig.json).
import { inviteStatus } from '../tenants/inviteCode.js'
import { enforceRateLimit, type RateLimitPort, type WindowState } from '../rateLimit.js'
import { createPlatformApi, type InviteRecord, type PlatformDeps, type PlatformPort, type TenantRow } from './platform.js'
import type { AuthLike, OperatorRecord } from './operatorGuard.js'
import type { PlatformAuditEntry } from './platformAudit.js'

export const T0 = 1_800_000_000_000
export const OP_UID = 'op1'

export interface Fake {
  port: PlatformPort
  invites: Map<string, InviteRecord & { claimId?: string | null }>
  operators: Map<string, OperatorRecord>
  /** Passwords set through `setOperatorPassword` (uid -> password). */
  passwords: Map<string, string>
  tenants: Map<string, TenantRow & { secret?: string }>
  audits: PlatformAuditEntry[]
  clock: { t: number }
  deps: PlatformDeps
  api: ReturnType<typeof createPlatformApi>
}

export const opToken = (over: Record<string, unknown> = {}, clock = T0): AuthLike => ({
  uid: OP_UID,
  token: { role: 'platform', platformAdmin: true, email_verified: true, auth_time: Math.floor(clock / 1000), ...over },
})

/** `limited: true` turns the real per-uid limiter on (off by default so seeding dozens of invites is not throttled). */
export function fake(over: Partial<PlatformDeps> = {}, opts: { limited?: boolean } = {}): Fake {
  const invites: Fake['invites'] = new Map()
  const operators: Fake['operators'] = new Map([[OP_UID, { name: 'Olive Operator', email: 'olive@convoypass.test', status: 'active' }]])
  const tenants: Fake['tenants'] = new Map()
  const audits: PlatformAuditEntry[] = []
  const passwords = new Map<string, string>()
  const clock = { t: T0 }
  const windows = new Map<string, WindowState>()
  const rl: RateLimitPort = {
    update: async (key, apply) => void windows.set(key, apply(windows.get(key))),
  }

  const port: PlatformPort = {
    getOperator: async (uid) => operators.get(uid) ?? null,
    createInvite: async (hash, invite, audit) => {
      if (invites.has(hash)) throw new Error('exists')
      invites.set(hash, { hash, ...invite, claimedAtMs: null, usedAtMs: null, tenantId: null, claimId: null })
      audits.push(audit)
    },
    listInvites: async ({ beforeMs, limit }) =>
      [...invites.values()]
        .filter((i) => beforeMs === null || i.createdAtMs < beforeMs)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limit)
        // A real read returns only invite fields; the fake adds nothing else.
        .map((i) => ({ hash: i.hash, createdAtMs: i.createdAtMs, expiresAtMs: i.expiresAtMs, claimedAtMs: i.claimedAtMs, usedAtMs: i.usedAtMs, tenantId: i.tenantId, ...(i.companyHint ? { companyHint: i.companyHint } : {}), ...(i.emailLock ? { emailLock: i.emailLock } : {}) })),
    findInviteHashes: async (prefix) => [...invites.keys()].filter((h) => h.startsWith(prefix)).slice(0, 2),
    revokeInvite: async (hash, nowMs, audit) => {
      const i = invites.get(hash)
      if (!i) return 'not-found'
      const s = inviteStatus(i, nowMs)
      if (s === 'used' || s === 'claimed') return s
      invites.delete(hash)
      audits.push(audit)
      return 'deleted'
    },
    tenantNames: async (ids) => new Map(ids.flatMap((id) => (tenants.has(id) ? [[id, tenants.get(id)!.name] as const] : []))),
    listTenants: async ({ beforeMs, limit }) =>
      [...tenants.values()]
        .filter((t) => beforeMs === null || t.createdAtMs < beforeMs)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limit),
    inviteTimes: async () => [...invites.values()],
    tenantCount: async () => tenants.size,
    setOperatorPassword: async (uid, password, audit) => {
      passwords.set(uid, password)
      operators.set(uid, { ...operators.get(uid)!, mustChangePassword: false })
      audits.push(audit)
    },
  }
  const deps: PlatformDeps = {
    port,
    now: () => clock.t,
    rateLimit: opts.limited ? (uid, fn) => enforceRateLimit(rl, uid, fn, clock.t) : async () => undefined,
    appBaseUrl: 'https://app.convoypass.test',
    inEmulator: false,
    ...over,
  }
  return { port, invites, operators, passwords, tenants, audits, clock, deps, api: createPlatformApi(deps) }
}

export const addTenant = (f: Fake, n: number, over: Partial<TenantRow> = {}) => {
  const id = `ten_${String(n).padStart(10, 'a')}`
  f.tenants.set(id, {
    tenantId: id, name: `Workspace ${n}`, createdAtMs: T0 - n * 1000, timezone: 'Asia/Colombo',
    adminName: `Admin ${n}`, adminEmail: `admin${n}@w${n}.test`, userCount: n, vehicleCount: n * 2, adminCount: 1, activeAdminCount: 1, adminSignedIn: false, ...over,
  })
  return id
}
