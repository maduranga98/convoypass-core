import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHECKLIST, DEFAULT_PASS_SETTINGS } from './defaultChecklist.js'
import { DEFAULT_REJECTION_REASONS } from './defaultRejectionReasons.js'
import { DEFAULT_SLA } from './defaultSla.js'
import { DEFAULT_GATES } from './gates.js'
import { setLogSink } from './logger.js'
import { enforceIpRateLimit, ipKey, type RateLimitPort, type WindowState } from './rateLimit.js'
import {
  ClaimLostError, completeSetup, SETUP_INVALID_MESSAGE, supportedTimezones, validateSetupInvite,
  type InviteView, type SetupDeps, type SetupPort,
} from './setup.js'
import { makeWorld, rejects, type World } from './test-utils.js'
import { CLAIM_TTL_MS, generateInviteCode, hashInviteCode } from './tenants/inviteCode.js'
import { buildTenantDocs, tenantDefaults, type ProvisionInput } from './tenants/tenantDefaults.js'

const T0 = 1_800_000_000_000
const GOOD = 'Correct-horse-battery-9'
const STAMP = { stamp: true }

interface Invite { expiresAtMs: number; usedAtMs: number | null; claimedAtMs: number | null; claimId: string | null; emailLock?: string; companyHint?: string; tenantId: string | null }

interface Env {
  w: World
  deps: SetupDeps
  invites: Map<string, Invite>
  tenants: Map<string, Record<string, unknown>>
  users: Map<string, Record<string, unknown>>
  audits: Record<string, unknown>[]
  clock: { t: number }
  /** Awaited inside the Auth createUser of the FIRST call that sets it, to interleave two calls. */
  gates: { createUser?: Promise<void>; failCommit?: boolean; failClaims?: boolean }
  nextTenantIds: string[]
}

function env(): Env {
  const w = makeWorld()
  const invites = new Map<string, Invite>()
  const tenants = new Map<string, Record<string, unknown>>()
  const users = new Map<string, Record<string, unknown>>()
  const audits: Record<string, unknown>[] = []
  const clock = { t: T0 }
  const gates: Env['gates'] = {}
  const nextTenantIds: string[] = []
  let n = 0

  const baseAuth = w.deps.auth
  const auth: SetupDeps['auth'] = {
    ...baseAuth,
    createUser: async (p) => {
      const gate = gates.createUser
      gates.createUser = undefined
      await (gate ?? new Promise<void>((r) => setTimeout(r, 2)))
      return baseAuth.createUser(p)
    },
    setCustomUserClaims: async (uid, c) => {
      if (gates.failClaims) throw new Error('claims boom')
      return baseAuth.setCustomUserClaims(uid, c)
    },
  }

  // Each port method reads and writes synchronously: that models a Firestore transaction.
  const port: SetupPort = {
    lookupInvite: async (hash, nowMs): Promise<InviteView | null> => {
      const i = invites.get(hash)
      if (!i) return null
      return { usable: i.usedAtMs === null && i.expiresAtMs > nowMs, ...(i.companyHint ? { companyHint: i.companyHint } : {}), ...(i.emailLock ? { emailLock: i.emailLock } : {}) }
    },
    claimInvite: async ({ hash, claimId, email, nowMs }) => {
      const i = invites.get(hash)
      if (!i || i.usedAtMs !== null || i.expiresAtMs <= nowMs) return false
      if (i.claimedAtMs !== null && nowMs - i.claimedAtMs < CLAIM_TTL_MS) return false
      if (i.emailLock && i.emailLock !== email) return false
      i.claimedAtMs = nowMs
      i.claimId = claimId
      return true
    },
    releaseClaim: async (hash, claimId) => {
      const i = invites.get(hash)
      if (i && i.usedAtMs === null && i.claimId === claimId) { i.claimedAtMs = null; i.claimId = null }
    },
    commitSetup: async ({ hash, claimId, input }) => {
      const i = invites.get(hash)
      if (!i || i.usedAtMs !== null || i.claimId !== claimId) throw new ClaimLostError()
      if (gates.failCommit) throw new Error('commit boom')
      if (tenants.has(input.tenantId) || users.has(input.admin.uid)) throw new Error('already exists') // create() semantics
      const docs = buildTenantDocs({ ...input, createdAt: STAMP } as ProvisionInput)
      tenants.set(input.tenantId, docs.tenant)
      users.set(input.admin.uid, docs.user)
      audits.push(...docs.audits)
      i.usedAtMs = clock.t
      i.tenantId = input.tenantId
      i.claimId = null
    },
  }
  const deps: SetupDeps = {
    auth, port, now: () => clock.t,
    newTenantId: () => nextTenantIds.shift() ?? `ten_${String(++n).padStart(10, 'a')}`,
    newClaimId: () => `claim-${++n}`,
    timezones: supportedTimezones,
  }
  return { w, deps, invites, tenants, users, audits, clock, gates, nextTenantIds }
}

const addInvite = (e: Env, over: Partial<Invite> = {}): string => {
  const code = generateInviteCode()
  e.invites.set(hashInviteCode(code), { expiresAtMs: T0 + 7 * 86_400_000, usedAtMs: null, claimedAtMs: null, claimId: null, tenantId: null, ...over })
  return code
}
const body = (code: string, over: Record<string, unknown> = {}) => ({
  code, companyName: 'Acme Quarry', adminName: 'Ada Admin', email: 'Ada@Acme.test', password: GOOD, timezone: 'Asia/Colombo', ...over,
})
const failure = async (p: Promise<unknown>) => p.then(() => null, (e: { code: string; message: string; details?: { reason?: string } }) => e)

describe('completeSetup', () => {
  let e: Env
  beforeEach(() => { e = env() })

  it('creates the tenant, the admin, claims, defaults and audit entries, and marks the invite used', async () => {
    const code = addInvite(e)
    const res = await completeSetup(e.deps, body(code))
    expect(Object.keys(res)).toEqual(['tenantId'])
    expect(res.tenantId).toMatch(/^ten_[a-z0-9]{10}$/)

    const tenant = e.tenants.get(res.tenantId)
    expect(tenant).toMatchObject({
      name: 'Acme Quarry', status: 'active', timezone: 'Asia/Colombo', retentionDays: 0,
      checklist: [...DEFAULT_CHECKLIST], rejectionReasons: [...DEFAULT_REJECTION_REASONS], gates: [...DEFAULT_GATES],
      sla: DEFAULT_SLA, passSettings: DEFAULT_PASS_SETTINGS,
    })
    expect(tenant).toMatchObject(tenantDefaults())

    const [uid, authUser] = [...e.w.authUsers.entries()][0]!
    expect(authUser).toMatchObject({ email: 'ada@acme.test', displayName: 'Ada Admin' })
    expect(e.w.claims.get(uid)).toEqual({ role: 'admin', tenantId: res.tenantId })
    expect(e.users.get(uid)).toMatchObject({
      tenantId: res.tenantId, role: 'admin', contractorId: null, email: 'ada@acme.test', status: 'active',
      mustChangePassword: false, createdBy: 'setup',
    })
    expect(e.audits.map((a) => a.action)).toEqual(['tenant.created', 'user.created'])
    expect(e.audits.every((a) => a.tenantId === res.tenantId && a.actorRole === 'system')).toBe(true)
    expect([...e.invites.values()][0]).toMatchObject({ usedAtMs: T0, tenantId: res.tenantId, claimId: null })
  })

  it('defaults the timezone to Asia/Colombo and accepts another valid one', async () => {
    const a = await completeSetup(e.deps, body(addInvite(e), { timezone: undefined }))
    expect(e.tenants.get(a.tenantId)?.timezone).toBe('Asia/Colombo')
    const b = await completeSetup(e.deps, body(addInvite(e), { email: 'b@acme.test', timezone: 'Europe/London' }))
    expect(e.tenants.get(b.tenantId)?.timezone).toBe('Europe/London')
  })

  it('answers used, expired, claimed, unknown and badly formatted codes identically', async () => {
    const used = addInvite(e, { usedAtMs: T0 - 1000, tenantId: 'ten_x' })
    const expired = addInvite(e, { expiresAtMs: T0 - 1 })
    const claimed = addInvite(e, { claimedAtMs: T0 - 1000, claimId: 'other' })
    const unknown = generateInviteCode()
    const answers = []
    for (const code of [used, expired, claimed, unknown, 'short', '', 'x'.repeat(43) + '!', 42 as unknown as string]) {
      answers.push(await failure(completeSetup(e.deps, body(code))))
    }
    for (const a of answers) {
      expect(a).toMatchObject({ code: 'failed-precondition', message: SETUP_INVALID_MESSAGE, details: { reason: 'setup-invalid' } })
    }
    expect(new Set(answers.map((a) => JSON.stringify([a?.code, a?.message, a?.details]))).size).toBe(1)
    expect(e.w.authUsers.size).toBe(0)
  })

  it('enforces emailLock (case-insensitively) with the same uniform answer', async () => {
    const code = addInvite(e, { emailLock: 'ada@acme.test' })
    const wrong = await failure(completeSetup(e.deps, body(code, { email: 'eve@evil.test' })))
    expect(wrong).toMatchObject({ code: 'failed-precondition', details: { reason: 'setup-invalid' } })
    expect(e.w.authUsers.size).toBe(0)
    expect([...e.invites.values()][0]!.claimId).toBeNull() // a mismatch never even claims
    await expect(completeSetup(e.deps, body(code, { email: ' ADA@acme.test ' }))).resolves.toHaveProperty('tenantId')
  })

  it('two concurrent calls with one code: exactly one success, one Auth user', async () => {
    const code = addInvite(e)
    const results = await Promise.allSettled([completeSetup(e.deps, body(code)), completeSetup(e.deps, body(code, { email: 'other@acme.test' }))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'failed-precondition', details: { reason: 'setup-invalid' } })
    expect(e.w.authUsers.size).toBe(1)
    expect(e.tenants.size).toBe(1)
  })

  it('a stale claim taken over by a second call: the slow first call loses and leaves no Auth user behind', async () => {
    const code = addInvite(e)
    let release!: () => void
    e.gates.createUser = new Promise<void>((r) => { release = r })
    const first = failure(completeSetup(e.deps, body(code)))
    await new Promise((r) => setTimeout(r, 5)) // first has claimed and waits inside createUser
    e.clock.t += CLAIM_TTL_MS + 1000
    await expect(completeSetup(e.deps, body(code, { email: 'second@acme.test' }))).resolves.toHaveProperty('tenantId')
    release()
    expect(await first).toMatchObject({ code: 'internal', details: { reason: 'internal' } })
    expect([...e.w.authUsers.values()].map((u) => u.email)).toEqual(['second@acme.test'])
    expect(e.tenants.size).toBe(1)
  })

  it('an existing email releases the claim; a retry with another email works', async () => {
    e.w.deps.auth.createUser({ email: 'taken@acme.test', password: 'x', displayName: 'T' }).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 5))
    const code = addInvite(e)
    const err = await failure(completeSetup(e.deps, body(code, { email: 'taken@acme.test' })))
    expect(err).toMatchObject({ code: 'already-exists', details: { reason: 'email-exists' }, message: 'An account with this email already exists.' })
    const invite = [...e.invites.values()][0]!
    expect(invite).toMatchObject({ claimedAtMs: null, claimId: null, usedAtMs: null })
    await expect(completeSetup(e.deps, body(code, { email: 'free@acme.test' }))).resolves.toHaveProperty('tenantId')
    expect(e.tenants.size).toBe(1)
  })

  it.each([
    ['the tenant transaction fails', (g: Env['gates']) => { g.failCommit = true }],
    ['setting claims fails', (g: Env['gates']) => { g.failClaims = true }],
  ])('when %s after Auth creation: deletes the user, releases the claim, returns a generic error', async (_n, inject) => {
    const code = addInvite(e)
    inject(e.gates)
    const err = await failure(completeSetup(e.deps, body(code)))
    expect(err).toMatchObject({ code: 'internal', details: { reason: 'internal' } })
    expect(err?.message).not.toMatch(/boom|claims|commit/i)
    expect(e.w.authUsers.size).toBe(0)
    expect(e.tenants.size + e.users.size + e.audits.length).toBe(0)
    expect([...e.invites.values()][0]).toMatchObject({ claimedAtMs: null, claimId: null, usedAtMs: null })
    e.gates.failCommit = false
    e.gates.failClaims = false
    await expect(completeSetup(e.deps, body(code))).resolves.toHaveProperty('tenantId') // the same link still works
  })

  it.each([
    ['too short', { password: 'Short-1x' }, 'weak-password'],
    ['nine characters', { password: 'abcdefg-9' }, 'weak-password'],
    ['common', { password: 'password1234' }, 'common-password'],
    ['common in another case', { password: 'QwertyUiop' }, 'common-password'],
    ['equal to the email', { email: 'ada.admin@acme.test', password: 'Ada.Admin@acme.test' }, 'password-is-email'],
    ['bad timezone', { timezone: 'Mars/Olympus' }, 'timezone-invalid'],
    ['company name too short', { companyName: 'A' }, 'invalid-input'],
    ['admin name too long', { adminName: 'x'.repeat(61) }, 'invalid-input'],
    ['invalid email', { email: 'not-an-email' }, 'invalid-input'],
  ])('rejects %s without claiming the invite or creating anything', async (_n, over, reason) => {
    const code = addInvite(e)
    const err = await failure(completeSetup(e.deps, body(code, over)))
    expect(err).toMatchObject({ code: 'invalid-argument', details: { reason } })
    expect(e.w.authUsers.size).toBe(0)
    expect([...e.invites.values()][0]).toMatchObject({ claimId: null })
  })

  it('can never join an existing tenant: a client-supplied tenantId is ignored and an id collision creates nothing', async () => {
    const first = await completeSetup(e.deps, body(addInvite(e)))
    const before = JSON.stringify([...e.tenants.entries()])
    const second = await completeSetup(e.deps, { ...body(addInvite(e), { email: 'two@acme.test' }), tenantId: first.tenantId, role: 'supervisor' })
    expect(second.tenantId).not.toBe(first.tenantId)
    expect(JSON.stringify(e.tenants.get(first.tenantId))).toBe(JSON.stringify(JSON.parse(before)[0][1]))

    e.nextTenantIds.push(first.tenantId) // the (astronomically unlikely) collision
    const collide = await failure(completeSetup(e.deps, body(addInvite(e), { email: 'three@acme.test' })))
    expect(collide).toMatchObject({ code: 'internal' })
    expect([...e.users.values()].filter((u) => u.tenantId === first.tenantId)).toHaveLength(1)
    expect([...e.w.authUsers.values()].map((u) => u.email).sort()).toEqual(['ada@acme.test', 'two@acme.test'])
  })

  it('never logs the code, the password or the request body', async () => {
    const lines: string[] = []
    const sink = (_m: string, f: Record<string, unknown>) => void lines.push(JSON.stringify(f))
    const restore = setLogSink({ info: sink, warn: sink, error: sink })
    try {
      const code = addInvite(e)
      e.gates.failCommit = true
      await failure(completeSetup(e.deps, body(code)))
      e.gates.failCommit = false
      await completeSetup(e.deps, body(code))
    } finally {
      restore()
    }
    const all = lines.join('\n')
    expect(all).toContain('completeSetup')
    expect(all).not.toContain(GOOD)
    expect(all).not.toMatch(/[A-Za-z0-9_-]{43}/)
    expect(all).not.toMatch(/ada@acme/i)
  })
})

describe('validateSetupInvite', () => {
  it('returns hint and email lock for a usable invite and a bare { valid: false } for everything else', async () => {
    const e = env()
    const ok = addInvite(e, { companyHint: 'Acme', emailLock: 'ada@acme.test' })
    expect(await validateSetupInvite(e.deps, { code: ok })).toEqual({ valid: true, companyHint: 'Acme', emailLock: 'ada@acme.test' })
    expect(await validateSetupInvite(e.deps, { code: addInvite(e) })).toEqual({ valid: true })
    const bad = [
      addInvite(e, { usedAtMs: T0 - 1 }), addInvite(e, { expiresAtMs: T0 - 1 }), generateInviteCode(), 'nope', '', undefined, 7,
    ]
    for (const code of bad) expect(await validateSetupInvite(e.deps, { code })).toEqual({ valid: false })
    expect(await validateSetupInvite(e.deps, null)).toEqual({ valid: false })
  })
})

describe('IP rate limits', () => {
  const memoryPort = (): RateLimitPort => {
    const docs = new Map<string, WindowState>()
    return { update: async (key, apply) => { docs.set(key, apply(docs.get(key))) } }
  }
  const HOUR = 3_600_000
  const base = Math.floor(1_800_000_000_000 / HOUR) * HOUR

  it('validateSetupInvite: 20 per minute per IP, then resource-exhausted; other IPs and the next minute are fine', async () => {
    const port = memoryPort()
    for (let i = 0; i < 20; i++) await enforceIpRateLimit(port, '203.0.113.7', 'validateSetupInvite', base + i)
    await rejects(enforceIpRateLimit(port, '203.0.113.7', 'validateSetupInvite', base + 30), 'resource-exhausted', 'rate-limited')
    await enforceIpRateLimit(port, '203.0.113.8', 'validateSetupInvite', base + 30)
    await enforceIpRateLimit(port, '203.0.113.7', 'validateSetupInvite', base + 60_000)
  })
  it('completeSetup: 10 per hour per IP', async () => {
    const port = memoryPort()
    for (let i = 0; i < 10; i++) await enforceIpRateLimit(port, '203.0.113.7', 'completeSetup', base + i * 60_000)
    await rejects(enforceIpRateLimit(port, '203.0.113.7', 'completeSetup', base + 11 * 60_000), 'resource-exhausted', 'rate-limited')
    await enforceIpRateLimit(port, '203.0.113.7', 'completeSetup', base + HOUR)
  })
  it('the two callables have separate counters and the key never contains the raw address', async () => {
    const port = memoryPort()
    for (let i = 0; i < 10; i++) await enforceIpRateLimit(port, '203.0.113.7', 'completeSetup', base)
    await enforceIpRateLimit(port, '203.0.113.7', 'validateSetupInvite', base)
    expect(ipKey('203.0.113.7')).toMatch(/^ip-[0-9a-f]{24}$/)
    expect(ipKey('203.0.113.7')).not.toContain('203')
    expect(ipKey(undefined)).toBe(ipKey('  '))
  })
})

describe('clientIpOf', () => {
  it('uses the proxy-appended end of X-Forwarded-For, so a spoofed first entry cannot dodge the limit', async () => {
    const { clientIpOf } = await import('./runtime.js')
    expect(clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.9' }, ip: '1.2.3.4' })).toBe('203.0.113.9')
    expect(clientIpOf({ headers: { 'x-forwarded-for': ['9.9.9.9', ' 203.0.113.9 '] } })).toBe('203.0.113.9')
    expect(clientIpOf({ headers: {}, ip: '198.51.100.1' })).toBe('198.51.100.1')
    expect(clientIpOf({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
    expect(clientIpOf(undefined)).toBeUndefined()
  })
})
