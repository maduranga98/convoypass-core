import { beforeEach, describe, expect, it } from 'vitest'
import { setLogSink } from '../logger.js'
import { runOperatorCall } from '../runtime.js'
import { completeSetup, supportedTimezones, validateSetupInvite, ClaimLostError, type SetupDeps, type SetupPort } from '../setup.js'
import { makeWorld } from '../test-utils.js'
import { CLAIM_TTL_MS, hashInviteCode, INVITE_CODE_PATTERN } from '../tenants/inviteCode.js'
import { buildTenantDocs, type ProvisionInput } from '../tenants/tenantDefaults.js'
import { requireOperator, OPERATOR_REAUTH_SECONDS } from './operatorGuard.js'
import { addTenant, fake, opToken, OP_UID, T0, type Fake } from './platform-test-utils.js'

const failure = async (p: Promise<unknown>) =>
  p.then(() => null, (e: { code: string; details?: { reason?: string } }) => e)

let f: Fake
beforeEach(() => { f = fake() })

describe('requireOperator', () => {
  const nowSeconds = Math.floor(T0 / 1000)
  const run = (auth: Parameters<typeof requireOperator>[0], mutating = false) => requireOperator(auth, f.port, { mutating, nowSeconds })

  it('accepts an active, verified operator', async () => {
    expect(await run(opToken())).toMatchObject({ uid: OP_UID, name: 'Olive Operator' })
  })
  it('refuses a signed-out caller as unauthenticated', async () => {
    expect((await failure(run(undefined)))?.code).toBe('unauthenticated')
  })
  it('denies a tenant admin and every other tenant user (same refusal)', async () => {
    for (const role of ['admin', 'officer', 'supervisor', 'driver', 'security']) {
      const e = await failure(run({ uid: 'u1', token: { role, tenantId: 'T1', email_verified: true, auth_time: nowSeconds } }))
      expect(e, role).toMatchObject({ code: 'permission-denied', details: { reason: 'forbidden' } })
    }
  })
  it('denies partial or forged claim shapes', async () => {
    for (const token of [
      { role: 'platform', email_verified: true },
      { platformAdmin: true, email_verified: true },
      { role: 'admin', platformAdmin: true, email_verified: true },
      { role: 'platform', platformAdmin: 'true', email_verified: true },
      // an operator token must never carry a tenant
      { role: 'platform', platformAdmin: true, tenantId: 'T1', email_verified: true },
    ]) {
      expect((await failure(run({ uid: OP_UID, token: { auth_time: nowSeconds, ...token } })))?.code).toBe('permission-denied')
    }
  })
  it('denies an operator whose email is not verified', async () => {
    expect((await failure(run(opToken({ email_verified: false }))))?.code).toBe('permission-denied')
    expect((await failure(run(opToken({ email_verified: undefined }))))?.code).toBe('permission-denied')
  })
  it('denies a missing or disabled operator doc even with valid claims', async () => {
    f.operators.set(OP_UID, { name: 'O', email: 'o@x.test', status: 'disabled' })
    expect((await failure(run(opToken())))?.code).toBe('permission-denied')
    f.operators.delete(OP_UID)
    expect((await failure(run(opToken())))?.code).toBe('permission-denied')
  })
  it('needs a login from the last 15 minutes for mutations only', async () => {
    const old = opToken({ auth_time: nowSeconds - OPERATOR_REAUTH_SECONDS - 1 })
    expect(await failure(run(old, true))).toMatchObject({ code: 'unauthenticated', details: { reason: 'reauth-required' } })
    expect(await run(old, false)).toMatchObject({ uid: OP_UID }) // reads work with an older login
    expect(await run(opToken({ auth_time: nowSeconds - OPERATOR_REAUTH_SECONDS }), true)).toMatchObject({ uid: OP_UID })
    expect((await failure(run(opToken({ auth_time: undefined }), true)))?.details?.reason).toBe('reauth-required')
  })
})

describe('every operator call is guarded', () => {
  it('refuses a tenant admin on all six callables, and a stale login on the two mutations', async () => {
    const admin = { uid: 'a1', token: { role: 'admin', tenantId: 'T1', email_verified: true, auth_time: T0 / 1000 } }
    const calls = [
      f.api.getOperatorProfile(admin), f.api.getOperatorOverview(admin), f.api.createSetupInvite(admin, {}),
      f.api.listSetupInvites(admin, {}), f.api.revokeSetupInvite(admin, { hashPrefix: 'abcdef12' }), f.api.listTenants(admin, {}),
    ]
    for (const c of calls) expect((await failure(c))?.code).toBe('permission-denied')
    const stale = opToken({ auth_time: T0 / 1000 - 3600 })
    expect((await failure(f.api.createSetupInvite(stale, {})))?.details?.reason).toBe('reauth-required')
    expect((await failure(f.api.revokeSetupInvite(stale, { hashPrefix: 'abcdef12' })))?.details?.reason).toBe('reauth-required')
    expect(await f.api.listSetupInvites(stale, {})).toMatchObject({ invites: [] })
    expect(f.invites.size).toBe(0)
  })
  it('rate limits per operator: 30 calls a minute, then resource-exhausted', async () => {
    const g = fake({}, { limited: true })
    for (let i = 0; i < 30; i++) await g.api.getOperatorOverview(opToken())
    expect((await failure(g.api.getOperatorOverview(opToken())))?.code).toBe('resource-exhausted')
    g.clock.t += 61_000
    expect(await g.api.getOperatorOverview(opToken({}, g.clock.t))).toBeTruthy()
  })
  it('getOperatorProfile returns name, email and whether a password change is pending', async () => {
    expect(await f.api.getOperatorProfile(opToken())).toEqual({ name: 'Olive Operator', email: 'olive@convoypass.test', mustChangePassword: false })
    f.operators.set(OP_UID, { ...f.operators.get(OP_UID)!, mustChangePassword: true })
    expect(await f.api.getOperatorProfile(opToken())).toMatchObject({ mustChangePassword: true })
  })
})

describe('changeOwnPassword (super admin)', () => {
  const NEW = 'Correct-Horse-Battery-9'
  const reasonOf = async (p: Promise<unknown>) => (await failure(p))?.details?.reason

  it('sets the password, clears mustChangePassword, audits without the password and returns only ok', async () => {
    const f = fake()
    f.operators.set(OP_UID, { ...f.operators.get(OP_UID)!, mustChangePassword: true })
    expect(await f.api.changeOwnPassword(opToken(), { newPassword: NEW })).toEqual({ ok: true })
    expect(f.passwords.get(OP_UID)).toBe(NEW)
    expect(f.operators.get(OP_UID)!.mustChangePassword).toBe(false)
    expect(f.audits).toEqual([{ actorUid: OP_UID, action: 'operator.passwordChanged', targetRef: OP_UID, meta: {} }])
    expect(JSON.stringify(f.audits)).not.toContain(NEW)
  })
  it('needs a sign-in from the last 5 minutes (a reauth-grade 15 minutes is not enough)', async () => {
    const f = fake()
    const sixMin = opToken({ auth_time: T0 / 1000 - 6 * 60 })
    expect(await reasonOf(f.api.changeOwnPassword(sixMin, { newPassword: NEW }))).toBe('recent-login-required')
    expect(f.passwords.size).toBe(0)
    expect(await f.api.changeOwnPassword(opToken({ auth_time: T0 / 1000 - 4 * 60 }), { newPassword: NEW })).toEqual({ ok: true })
  })
  it('refuses short, common and email-equal passwords', async () => {
    const f = fake()
    for (const newPassword of ['Short-1', '1234567890123', 'olive@convoypass.test', 'OLIVE@convoypass.test']) {
      expect(await reasonOf(f.api.changeOwnPassword(opToken(), { newPassword })), newPassword).toBe('invalid-input')
    }
    expect(f.passwords.size).toBe(0)
  })
  it('goes through the operator guard: a tenant admin, a disabled operator and a signed-out caller are refused', async () => {
    const f = fake()
    const admin = { uid: 'a1', token: { role: 'admin', tenantId: 'T1', email_verified: true, auth_time: T0 / 1000 } }
    expect((await failure(f.api.changeOwnPassword(admin, { newPassword: NEW })))?.code).toBe('permission-denied')
    expect((await failure(f.api.changeOwnPassword(undefined, { newPassword: NEW })))?.code).toBe('unauthenticated')
    f.operators.set(OP_UID, { ...f.operators.get(OP_UID)!, status: 'disabled' })
    expect((await failure(f.api.changeOwnPassword(opToken(), { newPassword: NEW })))?.code).toBe('permission-denied')
    expect(f.passwords.size).toBe(0)
  })
  it('is rate limited with the other operator calls', async () => {
    const g = fake({}, { limited: true })
    for (let i = 0; i < 30; i++) await failure(g.api.changeOwnPassword(opToken(), { newPassword: 'x' }))
    expect((await failure(g.api.changeOwnPassword(opToken(), { newPassword: NEW })))?.code).toBe('resource-exhausted')
  })
})

describe('createSetupInvite', () => {
  it('stores only the hash, returns a one-time link of the Module 8 shape, and audits the prefix only', async () => {
    const lines: string[] = []
    const restore = setLogSink({ info: (m, x) => lines.push(JSON.stringify([m, x])), warn: (m, x) => lines.push(JSON.stringify([m, x])), error: (m, x) => lines.push(JSON.stringify([m, x])) })
    try {
      const res = await runOperatorCall('createSetupInvite', opToken(), {}, (a) => f.api.createSetupInvite(a, { companyHint: ' Acme Quarry ', lockEmail: ' Ada@Acme.TEST ', expiresInDays: 3 }))
      expect(res.code).toMatch(INVITE_CODE_PATTERN)
      expect(res.link).toBe(`https://app.convoypass.test/setup#code=${res.code}`)
      expect(res.link).not.toContain('?')
      expect(res.hashPrefix).toBe(hashInviteCode(res.code).slice(0, 8))
      expect(res.expiresAt).toBe(T0 + 3 * 86_400_000)

      expect([...f.invites.keys()]).toEqual([hashInviteCode(res.code)])
      expect(f.invites.values().next().value).toMatchObject({ companyHint: 'Acme Quarry', emailLock: 'ada@acme.test', claimedAtMs: null, usedAtMs: null, tenantId: null })
      // The code is in the response and nowhere else: not the stored doc, not the audit entry, not the logs.
      expect(JSON.stringify([...f.invites.entries()])).not.toContain(res.code)
      expect(f.audits).toHaveLength(1)
      expect(f.audits[0]).toMatchObject({ actorUid: OP_UID, action: 'invite.created', targetRef: res.hashPrefix })
      expect(JSON.stringify(f.audits)).not.toContain(res.code)
      expect(JSON.stringify(f.audits)).not.toContain(hashInviteCode(res.code))
      // Force a failing call as well so the warn/error paths are in the log capture.
      await failure(runOperatorCall('createSetupInvite', opToken(), {}, (a) => f.api.createSetupInvite(a, { expiresInDays: 99 })))
      expect(lines.some((l) => l.includes('invalid-input'))).toBe(true)
      expect(lines.some((l) => l.includes('"outcome":"ok"'))).toBe(true)
      expect(lines.join('\n')).not.toContain(res.code)
    } finally { restore() }
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toMatch(/[A-Za-z0-9_-]{43}/)
  })
  it('defaults to 7 days and enforces 1-30 whole days', async () => {
    const r = await f.api.createSetupInvite(opToken(), {})
    expect(r.expiresAt).toBe(T0 + 7 * 86_400_000)
    for (const days of [0, 31, 1.5, -1, '7', null]) {
      expect((await failure(f.api.createSetupInvite(opToken(), { expiresInDays: days })))?.details?.reason, String(days)).toBe('invalid-input')
    }
    for (const days of [1, 30]) expect((await f.api.createSetupInvite(opToken(), { expiresInDays: days })).expiresAt).toBe(T0 + days * 86_400_000)
  })
  it('validates the hint (80 chars) and the lock email', async () => {
    expect((await failure(f.api.createSetupInvite(opToken(), { companyHint: 'x'.repeat(81) })))?.details?.reason).toBe('invalid-input')
    expect((await failure(f.api.createSetupInvite(opToken(), { lockEmail: 'nope' })))?.details?.reason).toBe('invalid-input')
    await f.api.createSetupInvite(opToken(), { companyHint: 'x'.repeat(80) })
    // an empty hint is the same as none
    await f.api.createSetupInvite(opToken(), { companyHint: '   ' })
    expect([...f.invites.values()].filter((i) => i.companyHint === undefined)).toHaveLength(1)
  })
  it('needs a usable APP_BASE_URL (https; http only in the emulator)', async () => {
    for (const appBaseUrl of ['', 'not a url', 'http://app.test']) {
      const g = fake({ appBaseUrl })
      expect((await failure(g.api.createSetupInvite(opToken(), {})))?.details?.reason, appBaseUrl).toBe('config-missing')
      expect(g.invites.size).toBe(0)
    }
    const emu = fake({ appBaseUrl: 'http://localhost:5173/', inEmulator: true })
    expect((await emu.api.createSetupInvite(opToken(), {})).link).toMatch(/^http:\/\/localhost:5173\/setup#code=/)
  })

  it('makes an invite that Module 8 accepts end to end (validate, then complete setup)', async () => {
    const w = makeWorld()
    const tenants = new Map<string, Record<string, unknown>>()
    const setupPort: SetupPort = {
      lookupInvite: async (hash, nowMs) => {
        const i = f.invites.get(hash)
        return i ? { usable: i.usedAtMs === null && i.expiresAtMs > nowMs, ...(i.companyHint ? { companyHint: i.companyHint } : {}), ...(i.emailLock ? { emailLock: i.emailLock } : {}) } : null
      },
      claimInvite: async ({ hash, claimId, email, nowMs }) => {
        const i = f.invites.get(hash)
        if (!i || i.usedAtMs !== null || i.expiresAtMs <= nowMs) return false
        if (i.claimedAtMs !== null && nowMs - i.claimedAtMs < CLAIM_TTL_MS) return false
        if (i.emailLock && i.emailLock !== email) return false
        i.claimedAtMs = nowMs; i.claimId = claimId
        return true
      },
      releaseClaim: async () => undefined,
      commitSetup: async ({ hash, claimId, input }) => {
        const i = f.invites.get(hash)
        if (!i || i.usedAtMs !== null || i.claimId !== claimId) throw new ClaimLostError()
        tenants.set(input.tenantId, buildTenantDocs({ ...input, createdAt: { stamp: true } } as ProvisionInput).tenant)
        i.usedAtMs = f.clock.t; i.tenantId = input.tenantId; i.claimId = null
        f.tenants.set(input.tenantId, { tenantId: input.tenantId, name: input.tenantName, createdAtMs: f.clock.t, timezone: input.timezone, adminName: input.admin.name, adminEmail: input.admin.email, userCount: 1, vehicleCount: 0, adminCount: 1, activeAdminCount: 1, adminSignedIn: false })
      },
    }
    const deps: SetupDeps = { auth: w.deps.auth, port: setupPort, now: () => f.clock.t, newTenantId: () => 'ten_zzzzzzzzzz', newClaimId: () => 'claim-1', timezones: supportedTimezones }

    const { code, hashPrefix } = await f.api.createSetupInvite(opToken(), { companyHint: 'Acme Quarry', lockEmail: 'Ada@Acme.test' })
    expect(await validateSetupInvite(deps, { code })).toEqual({ valid: true, companyHint: 'Acme Quarry', emailLock: 'ada@acme.test' })
    // locked to another email: the uniform refusal, invite untouched
    expect((await failure(completeSetup(deps, { code, companyName: 'Acme', adminName: 'Eve', email: 'eve@x.test', password: 'Correct-horse-battery-9', timezone: 'Asia/Colombo' })))?.details?.reason).toBe('setup-invalid')
    expect(await completeSetup(deps, { code, companyName: 'Acme Quarry', adminName: 'Ada', email: 'ADA@acme.test', password: 'Correct-horse-battery-9', timezone: 'Asia/Colombo' })).toEqual({ tenantId: 'ten_zzzzzzzzzz' })

    // The invite moves unused -> used and shows the workspace name; the console lists the workspace, counts only.
    const list = await f.api.listSetupInvites(opToken(), {})
    expect(list.invites[0]).toMatchObject({ hashPrefix, status: 'used', tenantId: 'ten_zzzzzzzzzz', tenantName: 'Acme Quarry' })
    expect((await f.api.listTenants(opToken(), {})).tenants[0]).toMatchObject({ name: 'Acme Quarry', adminEmail: 'ada@acme.test', userCount: 1, vehicleCount: 0 })
    // used invites cannot be revoked
    expect((await failure(f.api.revokeSetupInvite(opToken(), { hashPrefix })))?.details?.reason).toBe('invite-not-revocable')
  })
})

const seedInvites = async (n: number) => {
  const prefixes: string[] = []
  for (let i = 0; i < n; i++) {
    f.clock.t = T0 + i * 1000
    prefixes.push((await f.api.createSetupInvite(opToken({}, f.clock.t), { companyHint: `Co ${i}` })).hashPrefix)
  }
  f.clock.t = T0 + n * 1000
  return prefixes
}

describe('listSetupInvites', () => {
  it('returns prefixes and metadata only: no code, no full hash, nothing else', async () => {
    const { code } = await f.api.createSetupInvite(opToken(), { companyHint: 'Acme', lockEmail: 'a@b.test' })
    const res = await f.api.listSetupInvites(opToken(), {})
    expect(res.invites).toHaveLength(1)
    expect(Object.keys(res.invites[0]!).sort()).toEqual(['companyHint', 'createdAt', 'expiresAt', 'hashPrefix', 'lockEmail', 'status', 'tenantId', 'tenantName', 'usedAt'])
    expect(res.invites[0]!.hashPrefix).toHaveLength(8)
    const text = JSON.stringify(res)
    expect(text).not.toContain(code)
    expect(text).not.toContain(hashInviteCode(code))
    expect(res.nextCursor).toBeNull()
  })
  it('pages 25 at a time, newest first, without gaps or repeats', async () => {
    const prefixes = await seedInvites(60)
    const seen: string[] = []
    let cursor: string | undefined
    const sizes: number[] = []
    do {
      const r = await f.api.listSetupInvites(opToken(), cursor ? { cursor } : {})
      sizes.push(r.invites.length)
      seen.push(...r.invites.map((i) => i.hashPrefix))
      cursor = r.nextCursor ?? undefined
    } while (cursor)
    expect(sizes).toEqual([25, 25, 10])
    expect(seen).toEqual([...prefixes].reverse())
  })
  it('derives status from the clock and filters by it', async () => {
    const [a, b, c] = await seedInvites(3)
    const hash = (p: string) => [...f.invites.keys()].find((h) => h.startsWith(p))!
    f.invites.get(hash(a!))!.expiresAtMs = f.clock.t - 1 // expired
    f.invites.get(hash(b!))!.claimedAtMs = f.clock.t - 1000 // claimed, live
    const byStatus = async (status: string) => (await f.api.listSetupInvites(opToken(), { status })).invites.map((i) => i.hashPrefix)
    expect(await byStatus('expired')).toEqual([a])
    expect(await byStatus('claimed')).toEqual([b])
    expect(await byStatus('unused')).toEqual([c])
    expect(await byStatus('used')).toEqual([])
    f.clock.t += CLAIM_TTL_MS // the claim lapses: back to unused
    expect(await byStatus('claimed')).toEqual([])
    expect((await failure(f.api.listSetupInvites(opToken(), { status: 'bogus' })))?.details?.reason).toBe('invalid-input')
  })
  it('a status filter still fills a page and keeps paging past non-matching invites', async () => {
    await seedInvites(130)
    for (const [i, inv] of [...f.invites.values()].entries()) if (i % 5 !== 0) inv.expiresAtMs = 0
    const got: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const r = await f.api.listSetupInvites(opToken(), { status: 'unused', ...(cursor ? { cursor } : {}) })
      got.push(...r.invites.map((x) => x.hashPrefix))
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    expect(got).toHaveLength(26)
    expect(new Set(got).size).toBe(26)
  })
})

describe('revokeSetupInvite', () => {
  it('deletes an unused invite and audits it', async () => {
    const [p] = await seedInvites(2)
    expect(await f.api.revokeSetupInvite(opToken({}, f.clock.t), { hashPrefix: p!.toUpperCase() })).toEqual({ ok: true })
    expect(f.invites.size).toBe(1)
    expect(f.audits.at(-1)).toMatchObject({ actorUid: OP_UID, action: 'invite.revoked', targetRef: p })
  })
  it('refuses used and currently claimed invites, and keeps them', async () => {
    const [a, b] = await seedInvites(2)
    const hash = (p: string) => [...f.invites.keys()].find((h) => h.startsWith(p))!
    f.invites.get(hash(a!))!.usedAtMs = f.clock.t
    f.invites.get(hash(b!))!.claimedAtMs = f.clock.t - 1000
    const t = opToken({}, f.clock.t)
    for (const p of [a!, b!]) expect((await failure(f.api.revokeSetupInvite(t, { hashPrefix: p })))).toMatchObject({ code: 'failed-precondition', details: { reason: 'invite-not-revocable' } })
    expect(f.invites.size).toBe(2)
    expect(f.audits.filter((x) => x.action === 'invite.revoked')).toHaveLength(0)
  })
  it('an expired, never-used invite can be cleaned up', async () => {
    const [p] = await seedInvites(1)
    f.invites.values().next().value!.expiresAtMs = f.clock.t - 1
    expect(await f.api.revokeSetupInvite(opToken({}, f.clock.t), { hashPrefix: p! })).toEqual({ ok: true })
  })
  it('a missing prefix is not-found, an ambiguous one too, and a malformed one is invalid', async () => {
    const t = opToken()
    expect((await failure(f.api.revokeSetupInvite(t, { hashPrefix: 'deadbeef' })))).toMatchObject({ code: 'not-found', details: { reason: 'invite-not-found' } })
    // two invites sharing a prefix
    f.invites.set('abcdef12' + '0'.repeat(56), { hash: 'abcdef12' + '0'.repeat(56), createdAtMs: T0, expiresAtMs: T0 + 1e9, claimedAtMs: null, usedAtMs: null, tenantId: null })
    f.invites.set('abcdef12' + '1'.repeat(56), { hash: 'abcdef12' + '1'.repeat(56), createdAtMs: T0, expiresAtMs: T0 + 1e9, claimedAtMs: null, usedAtMs: null, tenantId: null })
    expect((await failure(f.api.revokeSetupInvite(t, { hashPrefix: 'abcdef12' })))?.code).toBe('not-found')
    expect(f.invites.size).toBe(2)
    for (const bad of ['abc', 'abcdef1', 'zzzzzzzz', 'abcdef123', 'ABCDEF12 ; x']) {
      expect((await failure(f.api.revokeSetupInvite(t, { hashPrefix: bad })))?.details?.reason, bad).toBe('invalid-input')
    }
  })
})

describe('listTenants and getOperatorOverview', () => {
  it('returns exactly the allowed fields (counts, never business data), 25 per page', async () => {
    for (let n = 1; n <= 30; n++) addTenant(f, n)
    // a port that leaks extra fields must not reach the response
    const leaky = f.port.listTenants
    f.port.listTenants = async (p) => (await leaky(p)).map((t) => ({ ...t, driverNames: ['Dan'], photoPath: 'tenants/x/a.jpg', passes: [1] }) as typeof t)
    const first = await f.api.listTenants(opToken(), {})
    expect(first.tenants).toHaveLength(25)
    expect(Object.keys(first.tenants[0]!).sort()).toEqual(['activeAdminCount', 'adminCount', 'adminEmail', 'adminName', 'adminSignedIn', 'createdAt', 'name', 'tenantId', 'timezone', 'userCount', 'vehicleCount'])
    expect(JSON.stringify(first)).not.toMatch(/driverNames|photoPath|passes|\.jpg/)
    expect(first.tenants[0]!.name).toBe('Workspace 1') // newest first
    const second = await f.api.listTenants(opToken(), { cursor: first.nextCursor! })
    expect(second.tenants.map((t) => t.name)).toEqual(['Workspace 26', 'Workspace 27', 'Workspace 28', 'Workspace 29', 'Workspace 30'])
    expect(second.nextCursor).toBeNull()
  })
  it('counts invites by status and tenants', async () => {
    const [a, b, c] = await seedInvites(4)
    const hash = (p: string) => [...f.invites.keys()].find((h) => h.startsWith(p))!
    f.invites.get(hash(a!))!.usedAtMs = f.clock.t
    f.invites.get(hash(b!))!.expiresAtMs = f.clock.t - 1
    f.invites.get(hash(c!))!.claimedAtMs = f.clock.t - 1
    addTenant(f, 1)
    expect(await f.api.getOperatorOverview(opToken({}, f.clock.t))).toEqual({ invites: { unused: 1, claimed: 1, used: 1, expired: 1 }, tenants: 1 })
  })
})
