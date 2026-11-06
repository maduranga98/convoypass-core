// Module 9: the platform operator console. Callables for people who run ConvoyPass itself, not for any client tenant.
//   createSetupInvite / listSetupInvites / revokeSetupInvite   Module 8 invites (`setupInvites/{sha256hex(code)}`, unchanged)
//   listTenants / getOperatorOverview                          counts and names only, never tenant business data
//   getOperatorProfile                                         the operator's own `operators/{uid}` (clients cannot read it)
// The code exists in exactly one place: the `createSetupInvite` response. It is never stored, logged or audited.
import { isCommonPassword } from '../auth/commonPasswords.js'
import { parse } from '../core.js'
import { fail } from '../errors.js'
import {
  changeOwnPasswordSchema, createSetupInviteSchema, listSetupInvitesSchema, listTenantsSchema, revokeSetupInviteSchema,
} from '../schemas.js'
import {
  generateInviteCode, hashInviteCode, inviteLink, inviteStatus, type InviteStatus, type InviteTimes,
} from '../tenants/inviteCode.js'
import { requireOperator, type AuthLike, type OperatorCaller, type OperatorPort } from './operatorGuard.js'
import { hashPrefixOf, platformAudit, type PlatformAuditEntry } from './platformAudit.js'

export const PAGE_SIZE = 25
/** A super admin chooses 14+ characters (the sign-in page mirrors this; `superadmin:create` enforces it for stdin passwords). */
export const OPERATOR_PASSWORD_MIN_LENGTH = 14
/** `changeOwnPassword` for a super admin needs a sign-in this recent (the same 5 minutes as for workspace users). */
export const OPERATOR_PASSWORD_REAUTH_SECONDS = 5 * 60
const SCAN_BATCH = 100
const MAX_SCAN_BATCHES = 5
const DAY_MS = 86_400_000

/** One invite as the port reads it. `hash` never leaves this file: responses carry the 8-char prefix only. */
export interface InviteRecord extends InviteTimes {
  hash: string
  createdAtMs: number
  companyHint?: string
  emailLock?: string
  tenantId: string | null
}

export interface NewInvite {
  createdAtMs: number
  expiresAtMs: number
  companyHint?: string
  emailLock?: string
}

export interface TenantRow {
  tenantId: string
  name: string
  createdAtMs: number
  timezone: string
  adminName: string | null
  adminEmail: string | null
  userCount: number
  vehicleCount: number
  adminCount: number
  activeAdminCount: number
  /** At least one admin of the workspace has signed in. */
  adminSignedIn: boolean
}

export type RevokeOutcome = 'deleted' | 'not-found' | 'used' | 'claimed'

export interface PlatformPort extends OperatorPort {
  /** Atomically creates the invite (fails if the hash exists) and its audit entry. */
  createInvite(hash: string, invite: NewInvite, audit: PlatformAuditEntry): Promise<void>
  /** Newest first, `createdAt < beforeMs` (all when null). */
  listInvites(p: { beforeMs: number | null; limit: number }): Promise<InviteRecord[]>
  /** Hashes starting with `prefix` (at most 2: the caller only needs to know "none", "one" or "ambiguous"). */
  findInviteHashes(prefix: string): Promise<string[]>
  /** One transaction: re-reads the invite, refuses a used or currently claimed one, deletes it and writes the audit entry. */
  revokeInvite(hash: string, nowMs: number, audit: PlatformAuditEntry): Promise<RevokeOutcome>
  tenantNames(ids: string[]): Promise<Map<string, string>>
  /** Newest first, `createdAt < beforeMs`. Counts come from `count()` queries; nothing else about a tenant is read out. */
  listTenants(p: { beforeMs: number | null; limit: number }): Promise<TenantRow[]>
  inviteTimes(): Promise<InviteTimes[]>
  tenantCount(): Promise<number>
  /** Sets the operator's Auth password, then clears `operators.mustChangePassword` and writes the audit entry (never the password). */
  setOperatorPassword(uid: string, password: string, audit: PlatformAuditEntry): Promise<void>
}

export interface PlatformDeps {
  port: PlatformPort
  now: () => number
  /** Per-uid fixed-window limit (30 calls a minute). */
  rateLimit: (uid: string, fn: string) => Promise<void>
  /** `APP_BASE_URL`. */
  appBaseUrl: string
  /** http is allowed for the link only in the emulator. */
  inEmulator: boolean
  generateCode?: () => string
}

export interface InviteView {
  hashPrefix: string
  companyHint: string | null
  lockEmail: string | null
  status: InviteStatus
  createdAt: number
  expiresAt: number
  usedAt: number | null
  tenantId: string | null
  tenantName: string | null
}

export interface TenantView {
  tenantId: string
  name: string
  createdAt: number
  timezone: string
  adminName: string | null
  adminEmail: string | null
  userCount: number
  vehicleCount: number
  adminCount: number
  activeAdminCount: number
  adminSignedIn: boolean
}

const linkBase = (deps: PlatformDeps): string => {
  let u: URL
  try {
    u = new URL(deps.appBaseUrl)
  } catch {
    throw fail('failed-precondition', 'config-missing', 'The app address is not configured')
  }
  if (u.protocol !== 'https:' && !(deps.inEmulator && u.protocol === 'http:')) {
    throw fail('failed-precondition', 'config-missing', 'The app address is not configured')
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/** `requireOperator` (fresh login for mutations), then the per-uid rate limit: the front door of every super admin call. */
export const makeGuard = (deps: Pick<PlatformDeps, 'port' | 'now' | 'rateLimit'>) =>
  async <T>(auth: AuthLike | undefined, fn: string, mutating: boolean, run: (op: OperatorCaller) => Promise<T>): Promise<T> => {
    const op = await requireOperator(auth, deps.port, { mutating, nowSeconds: Math.floor(deps.now() / 1000) })
    await deps.rateLimit(op.uid, fn)
    return run(op)
  }

export function createPlatformApi(deps: PlatformDeps) {
  const guarded = makeGuard(deps)

  const toView = (r: InviteRecord, nowMs: number, names: Map<string, string>): InviteView => ({
    hashPrefix: hashPrefixOf(r.hash),
    companyHint: r.companyHint ?? null,
    lockEmail: r.emailLock ?? null,
    status: inviteStatus(r, nowMs),
    createdAt: r.createdAtMs,
    expiresAt: r.expiresAtMs,
    usedAt: r.usedAtMs,
    tenantId: r.tenantId,
    tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null,
  })

  return {
    getOperatorProfile: (auth: AuthLike | undefined) =>
      guarded(auth, 'getOperatorProfile', false, async (op) => ({ name: op.name, email: op.email, mustChangePassword: op.mustChangePassword })),

    /**
     * The super admin's own password (the `changeOwnPassword` callable routes platform tokens here). Same guard as every
     * operator call, plus a sign-in from the last 5 minutes; the new password is never logged, audited or returned.
     */
    async changeOwnPassword(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'changeOwnPassword', false, async (op) => {
        const { newPassword } = parse(changeOwnPasswordSchema, raw ?? {})
        const authTime = typeof auth?.token.auth_time === 'number' ? auth.token.auth_time : 0
        if (Math.floor(deps.now() / 1000) - authTime > OPERATOR_PASSWORD_REAUTH_SECONDS) {
          throw fail('failed-precondition', 'recent-login-required', 'Please sign in again to change your password')
        }
        if (newPassword.length < OPERATOR_PASSWORD_MIN_LENGTH) {
          throw fail('invalid-argument', 'invalid-input', `Password must be at least ${OPERATOR_PASSWORD_MIN_LENGTH} characters`)
        }
        if (newPassword.toLowerCase() === op.email.toLowerCase() || isCommonPassword(newPassword)) {
          throw fail('invalid-argument', 'invalid-input', 'Choose a password that is not your email address or a common one')
        }
        try {
          await deps.port.setOperatorPassword(op.uid, newPassword, platformAudit(op.uid, 'operator.passwordChanged', op.uid, {}))
        } catch {
          throw fail('internal', 'internal', 'Could not change the password')
        }
        return { ok: true as const }
      })
    },

    async createSetupInvite(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'createSetupInvite', true, async (op) => {
        const input = parse(createSetupInviteSchema, raw ?? {})
        const base = linkBase(deps)
        const code = (deps.generateCode ?? generateInviteCode)()
        const hash = hashInviteCode(code)
        const now = deps.now()
        const companyHint = input.companyHint || undefined
        const invite: NewInvite = {
          createdAtMs: now,
          expiresAtMs: now + input.expiresInDays * DAY_MS,
          ...(companyHint ? { companyHint } : {}),
          ...(input.lockEmail ? { emailLock: input.lockEmail } : {}),
        }
        const audit = platformAudit(op.uid, 'invite.created', hashPrefixOf(hash), {
          expiresInDays: input.expiresInDays,
          locked: Boolean(input.lockEmail),
          hasCompanyHint: Boolean(companyHint),
        })
        await deps.port.createInvite(hash, invite, audit)
        return { code, link: inviteLink(base, code), hashPrefix: hashPrefixOf(hash), expiresAt: invite.expiresAtMs }
      })
    },

    async listSetupInvites(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'listSetupInvites', false, async () => {
        const input = parse(listSetupInvitesSchema, raw ?? {})
        const now = deps.now()
        // Status is derived from the clock (expired, claimed), so it is filtered here: scan newest-first until a page is full.
        const matches: InviteRecord[] = []
        let beforeMs = input.cursor ? Number(input.cursor) : null
        let lastScanned: number | null = null
        let exhausted = false
        for (let i = 0; i < MAX_SCAN_BATCHES && matches.length <= PAGE_SIZE && !exhausted; i++) {
          const batch = await deps.port.listInvites({ beforeMs, limit: SCAN_BATCH })
          for (const r of batch) {
            lastScanned = r.createdAtMs
            if (!input.status || inviteStatus(r, now) === input.status) matches.push(r)
            if (matches.length > PAGE_SIZE) break
          }
          exhausted = batch.length < SCAN_BATCH
          beforeMs = lastScanned
        }
        const page = matches.slice(0, PAGE_SIZE)
        const more = matches.length > PAGE_SIZE
        const nextCursor = more ? String(page[page.length - 1]!.createdAtMs) : !exhausted && lastScanned !== null ? String(lastScanned) : null
        const usedIds = [...new Set(page.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))]
        const names = usedIds.length ? await deps.port.tenantNames(usedIds) : new Map<string, string>()
        return { invites: page.map((r) => toView(r, now, names)), nextCursor }
      })
    },

    async revokeSetupInvite(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'revokeSetupInvite', true, async (op) => {
        const { hashPrefix } = parse(revokeSetupInviteSchema, raw)
        const hashes = await deps.port.findInviteHashes(hashPrefix)
        // Missing and ambiguous look the same: the operator has to use the list, not guess.
        if (hashes.length !== 1) throw fail('not-found', 'invite-not-found', 'Invite not found')
        const outcome = await deps.port.revokeInvite(hashes[0]!, deps.now(), platformAudit(op.uid, 'invite.revoked', hashPrefix, {}))
        if (outcome === 'not-found') throw fail('not-found', 'invite-not-found', 'Invite not found')
        if (outcome === 'used') throw fail('failed-precondition', 'invite-not-revocable', 'This invite was already used')
        if (outcome === 'claimed') throw fail('failed-precondition', 'invite-not-revocable', 'Someone is setting up with this invite right now')
        return { ok: true as const }
      })
    },

    async listTenants(auth: AuthLike | undefined, raw: unknown) {
      return guarded(auth, 'listTenants', false, async () => {
        const input = parse(listTenantsSchema, raw ?? {})
        const rows = await deps.port.listTenants({ beforeMs: input.cursor ? Number(input.cursor) : null, limit: PAGE_SIZE + 1 })
        const page = rows.slice(0, PAGE_SIZE)
        // Rebuilt field by field: nothing the port happens to return can leak into the response.
        const tenants: TenantView[] = page.map((t) => ({
          tenantId: t.tenantId, name: t.name, createdAt: t.createdAtMs, timezone: t.timezone,
          adminName: t.adminName, adminEmail: t.adminEmail, userCount: t.userCount, vehicleCount: t.vehicleCount,
          adminCount: t.adminCount, activeAdminCount: t.activeAdminCount, adminSignedIn: t.adminSignedIn,
        }))
        return { tenants, nextCursor: rows.length > PAGE_SIZE ? String(page[page.length - 1]!.createdAtMs) : null }
      })
    },

    getOperatorOverview: (auth: AuthLike | undefined) =>
      guarded(auth, 'getOperatorOverview', false, async () => {
        const now = deps.now()
        const [times, tenants] = await Promise.all([deps.port.inviteTimes(), deps.port.tenantCount()])
        const invites: Record<InviteStatus, number> = { unused: 0, claimed: 0, used: 0, expired: 0 }
        for (const t of times) invites[inviteStatus(t, now)]++
        return { invites, tenants }
      }),
  }
}

export type PlatformApi = ReturnType<typeof createPlatformApi>
