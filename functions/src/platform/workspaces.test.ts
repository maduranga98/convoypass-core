import { beforeEach, describe, expect, it } from 'vitest'
import { generateTempPassword, TEMP_PASSWORD_PATTERN } from '../auth/tempPassword.js'
import { setLogSink } from '../logger.js'
import { runOperatorCall } from '../runtime.js'
import { tenantDefaults } from '../tenants/tenantDefaults.js'
import { OPERATOR_REAUTH_SECONDS } from './operatorGuard.js'
import { opToken, OP_UID, T0 } from './platform-test-utils.js'
import { assertTargetIsTenantAdmin } from './workspaces.js'
import { wsFake, type WsFake } from './workspaces-test-utils.js'

const failure = async (p: Promise<unknown>) => p.then(() => null, (e: { code: string; details?: { reason?: string } }) => e)
const NEW = { companyName: 'Acme Quarry', timezone: 'Asia/Colombo', adminName: 'Ada Admin', adminEmail: 'Ada@Acme.test' }
const PW = 'Abcdefgh23456789'

let f: WsFake
beforeEach(() => { f = wsFake() })
const t = () => opToken()

/** A workspace with two admins; returns ids. */
async function seedWorkspace() {
  f.nextTenantIds.push('ten_aaaaaaaaaa')
  const a = await f.ws.createWorkspace(t(), NEW)
  const b = await f.ws.addTenantAdmin(t(), { tenantId: a.tenantId, name: 'Bob Backup', email: 'bob@acme.test' })
  return { tenantId: a.tenantId, a: a.adminUid, b: b.adminUid }
}

describe('temp password generator', () => {
  it('is 16 chars from an alphabet without 0 O 1 l I, with an upper, a lower and a digit', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateTempPassword()
      expect(p).toMatch(TEMP_PASSWORD_PATTERN)
      expect(p).not.toMatch(/[0O1lI]/)
      expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/\d/)
    }
    expect(new Set(Array.from({ length: 50 }, () => generateTempPassword())).size).toBe(50)
  })
})

describe('guards: every function', () => {
  const calls = (api: WsFake['ws']) => ({
    createWorkspace: (a: Parameters<typeof api.createWorkspace>[0]) => api.createWorkspace(a, NEW),
    addTenantAdmin: (a: Parameters<typeof api.createWorkspace>[0]) => api.addTenantAdmin(a, { tenantId: 'ten_aaaaaaaaaa', name: 'Bo', email: 'bo@x.test' }),
    resetTenantAdminCredential: (a: Parameters<typeof api.createWorkspace>[0]) => api.resetTenantAdminCredential(a, { tenantId: 'ten_aaaaaaaaaa', uid: 'u1' }),
    setTenantAdminStatus: (a: Parameters<typeof api.createWorkspace>[0]) => api.setTenantAdminStatus(a, { tenantId: 'ten_aaaaaaaaaa', uid: 'u1', status: 'disabled' }),
    updateTenantAdmin: (a: Parameters<typeof api.createWorkspace>[0]) => api.updateTenantAdmin(a, { tenantId: 'ten_aaaaaaaaaa', uid: 'u1', name: 'New Name' }),
    getWorkspace: (a: Parameters<typeof api.createWorkspace>[0]) => api.getWorkspace(a, { tenantId: 'ten_aaaaaaaaaa' }),
  })
  it('denies tenant admins and every other role', async () => {
    for (const role of ['admin', 'officer', 'supervisor', 'driver', 'security']) {
      const a = { uid: 'x1', token: { role, tenantId: 'T1', email_verified: true, auth_time: T0 / 1000 } }
      for (const [name, call] of Object.entries(calls(f.ws))) expect((await failure(call(a)))?.code, `${role} ${name}`).toBe('permission-denied')
    }
    expect(f.authUsers.size).toBe(0)
    expect(f.tenantDocs.size).toBe(0)
  })
  it('denies an unverified email and a disabled operator', async () => {
    for (const [name, call] of Object.entries(calls(f.ws))) expect((await failure(call(opToken({ email_verified: false }))))?.code, name).toBe('permission-denied')
    f.operators.set(OP_UID, { name: 'O', email: 'o@x.test', status: 'disabled' })
    for (const [name, call] of Object.entries(calls(f.ws))) expect((await failure(call(t())))?.code, name).toBe('permission-denied')
    expect(f.authUsers.size).toBe(0)
  })
  it('a stale login gets reauth-required on mutations; reads still work', async () => {
    const stale = opToken({ auth_time: T0 / 1000 - OPERATOR_REAUTH_SECONDS - 5 })
    for (const name of ['createWorkspace', 'addTenantAdmin', 'resetTenantAdminCredential', 'setTenantAdminStatus', 'updateTenantAdmin'] as const) {
      expect((await failure(calls(f.ws)[name](stale)))?.details?.reason, name).toBe('reauth-required')
    }
    expect(f.authUsers.size).toBe(0)
    // a read passes the guard (then fails only because the workspace does not exist)
    expect((await failure(calls(f.ws).getWorkspace(stale)))?.details?.reason).toBe('workspace-not-found')
  })
  it('rate limits per operator (30 a minute)', async () => {
    const g = wsFake({ limited: true })
    g.nextTenantIds.push('ten_aaaaaaaaaa')
    const { tenantId } = await g.ws.createWorkspace(opToken(), NEW)
    for (let i = 0; i < 30; i++) await g.ws.getWorkspace(opToken(), { tenantId })
    expect((await failure(g.ws.getWorkspace(opToken(), { tenantId })))?.details?.reason).toBe('rate-limited')
  })
})

describe('createWorkspace', () => {
  it('creates exactly the provisionTenant defaults, the admin, claims, forced change and both audit entries', async () => {
    f.nextTenantIds.push('ten_aaaaaaaaaa'); f.nextPasswords.push(PW)
    const res = await f.ws.createWorkspace(t(), NEW)
    expect(res).toEqual({ tenantId: 'ten_aaaaaaaaaa', adminUid: expect.any(String), loginUrl: 'https://app.convoypass.test/login/staff', tempPassword: PW })

    expect(f.tenantDocs.get('ten_aaaaaaaaaa')).toMatchObject({ name: 'Acme Quarry', status: 'active', ...tenantDefaults('Asia/Colombo') })
    expect(f.users.get(res.adminUid)).toMatchObject({ tenantId: 'ten_aaaaaaaaaa', role: 'admin', name: 'Ada Admin', email: 'ada@acme.test', status: 'active', mustChangePassword: true, createdBy: 'platform' })
    expect(f.authUsers.get(res.adminUid)).toMatchObject({ email: 'ada@acme.test', password: PW, displayName: 'Ada Admin', claims: { role: 'admin', tenantId: 'ten_aaaaaaaaaa' } })

    // the tenant's own audit log says who did it (and nothing secret)
    expect(f.tenantAudits).toHaveLength(2)
    for (const a of f.tenantAudits) expect(a).toMatchObject({ tenantId: 'ten_aaaaaaaaaa', actorUid: OP_UID, actorRole: 'superadmin', actorName: 'ConvoyPass Super Admin' })
    expect(f.tenantAudits.map((a) => a.action).sort()).toEqual(['tenant.created', 'user.created'])
    expect(f.audits).toEqual([{ actorUid: OP_UID, action: 'workspace.created', targetRef: 'ten_aaaaaaaaaa', meta: { timezone: 'Asia/Colombo' } }])
  })
  it('defaults the timezone and rejects an unknown one', async () => {
    const { tenantId } = await f.ws.createWorkspace(t(), { ...NEW, timezone: undefined })
    expect(f.tenantDocs.get(tenantId)?.timezone).toBe('Asia/Colombo')
    expect((await failure(f.ws.createWorkspace(t(), { ...NEW, adminEmail: 'z@z.test', timezone: 'Mars/Base' })))?.details?.reason).toBe('timezone-invalid')
  })
  it('validates names, email and company length', async () => {
    for (const bad of [{ companyName: 'A' }, { companyName: 'x'.repeat(81) }, { adminName: 'A' }, { adminName: 'x'.repeat(61) }, { adminEmail: 'nope' }]) {
      expect((await failure(f.ws.createWorkspace(t(), { ...NEW, ...bad })))?.details?.reason, JSON.stringify(bad)).toBe('invalid-input')
    }
    expect(f.authUsers.size).toBe(0)
  })
  it('the temporary password appears only in the response: not in Firestore, either audit log or the logs', async () => {
    const lines: string[] = []
    const rec = (m: string, x: Record<string, unknown>) => void lines.push(JSON.stringify([m, x]))
    const restore = setLogSink({ info: rec, warn: rec, error: rec })
    let res
    try {
      res = await runOperatorCall('createWorkspace', t(), NEW, (a, d) => f.ws.createWorkspace(a, d))
      await failure(runOperatorCall('createWorkspace', t(), NEW, (a, d) => f.ws.createWorkspace(a, d))) // duplicate: error path logged too
    } finally { restore() }
    const stored = JSON.stringify([...f.tenantDocs.entries(), ...f.users.entries(), f.tenantAudits, f.audits])
    expect(stored).not.toContain(res.tempPassword)
    expect(lines.join('\n')).not.toContain(res.tempPassword)
    expect(lines.length).toBeGreaterThan(1)
    expect(res.tempPassword).toMatch(TEMP_PASSWORD_PATTERN)
  })
  it('rejects an email that any account already uses: Auth user, tenant user, operator, any case', async () => {
    await f.ws.createWorkspace(t(), NEW)
    expect((await failure(f.ws.createWorkspace(t(), { ...NEW, adminEmail: 'ADA@acme.TEST' })))).toMatchObject({ code: 'already-exists', details: { reason: 'email-exists' } })
    f.users.set('ghost', { tenantId: 'T9', role: 'supervisor', name: 'S', email: 'sup@other.test', status: 'active', mustChangePassword: false, createdAtMs: 1, createdBy: 'x' })
    expect((await failure(f.ws.createWorkspace(t(), { ...NEW, adminEmail: 'sup@other.test' })))?.details?.reason).toBe('email-exists')
    expect((await failure(f.ws.createWorkspace(t(), { ...NEW, adminEmail: 'olive@convoypass.test' })))?.details?.reason).toBe('email-exists')
    expect(f.tenantDocs.size).toBe(1)
    // an Auth-level race (created between the check and the call) maps to the same answer and leaves nothing behind
    f.failures.createUser = 'exists'
    expect((await failure(f.ws.createWorkspace(t(), { ...NEW, adminEmail: 'new@acme.test' })))?.details?.reason).toBe('email-exists')
    expect(f.tenantDocs.size).toBe(1)
  })
  it('a failure after the Auth user exists deletes it and writes no tenant docs (claims step, commit step)', async () => {
    for (const failing of ['claims', 'commit'] as const) {
      f.failures[failing] = true
      expect((await failure(f.ws.createWorkspace(t(), NEW)))).toMatchObject({ code: 'internal', details: { reason: 'internal' } })
      f.failures[failing] = false
      expect(f.authUsers.size, failing).toBe(0)
      expect(f.tenantDocs.size, failing).toBe(0)
      expect(f.users.size, failing).toBe(0)
      expect(f.tenantAudits, failing).toHaveLength(0)
      expect(f.audits, failing).toHaveLength(0)
    }
    // and the same email works afterwards
    expect((await f.ws.createWorkspace(t(), NEW)).tenantId).toMatch(/^ten_/)
  })
  it('needs APP_BASE_URL for the login URL', async () => {
    const g = wsFake()
    const bad = (await import('./workspaces.js')).createWorkspaceApi({ ...g.deps, appBaseUrl: '', auth: { ...g.authUsers } as never, workspaces: {} as never, newTenantId: () => 'x', newTempPassword: () => PW, timezones: () => new Set(['Asia/Colombo']) })
    expect((await failure(bad.createWorkspace(t(), NEW)))?.details?.reason).toBe('config-missing')
  })
})

describe('addTenantAdmin', () => {
  it('adds a second admin to an existing workspace with a temporary password and both audits', async () => {
    const { tenantId, b } = await seedWorkspace()
    expect(f.users.get(b)).toMatchObject({ tenantId, role: 'admin', mustChangePassword: true, createdBy: 'platform', email: 'bob@acme.test' })
    expect(f.authUsers.get(b)?.claims).toEqual({ role: 'admin', tenantId })
    expect(f.tenantAudits.at(-1)).toMatchObject({ action: 'user.create', actorRole: 'superadmin', targetId: b, meta: { role: 'admin', source: 'platform' } })
    expect(f.audits.at(-1)).toMatchObject({ action: 'admin.created', targetRef: tenantId })
    expect(JSON.stringify([f.tenantAudits, f.audits, [...f.users.values()]])).not.toContain(f.authUsers.get(b)!.password)
  })
  it('rejects an unknown workspace and a duplicate email, and cleans up on failure', async () => {
    const { tenantId } = await seedWorkspace()
    expect((await failure(f.ws.addTenantAdmin(t(), { tenantId: 'nope', name: 'Bo Bo', email: 'x@x.test' })))?.details?.reason).toBe('workspace-not-found')
    expect((await failure(f.ws.addTenantAdmin(t(), { tenantId, name: 'Bo Bo', email: 'bob@acme.test' })))?.details?.reason).toBe('email-exists')
    const before = f.authUsers.size
    f.failures.commit = true
    expect((await failure(f.ws.addTenantAdmin(t(), { tenantId, name: 'Cy Cy', email: 'cy@acme.test' })))?.code).toBe('internal')
    expect(f.authUsers.size).toBe(before)
  })
})

describe('resetTenantAdminCredential', () => {
  it('sets a new temporary password, forces a change, revokes tokens, audits without the password', async () => {
    const { tenantId, a } = await seedWorkspace()
    f.users.get(a)!.mustChangePassword = false
    f.nextPasswords.push('Zzzzzzzz22222222')
    const res = await f.ws.resetTenantAdminCredential(t(), { tenantId, uid: a })
    expect(res).toMatchObject({ tenantId, adminUid: a, tempPassword: 'Zzzzzzzz22222222', loginUrl: 'https://app.convoypass.test/login/staff' })
    expect(f.authUsers.get(a)?.password).toBe('Zzzzzzzz22222222')
    expect(f.users.get(a)?.mustChangePassword).toBe(true)
    expect(f.revoked).toContain(a)
    expect(f.tenantAudits.at(-1)).toMatchObject({ action: 'user.resetCredential', actorRole: 'superadmin', targetId: a })
    expect(f.audits.at(-1)).toMatchObject({ action: 'admin.credentialReset' })
    expect(JSON.stringify([f.tenantAudits, f.audits])).not.toContain('Zzzzzzzz22222222')
  })
  it('rejects another tenant, a non-admin target and a missing target (all user-not-found)', async () => {
    const { tenantId } = await seedWorkspace()
    f.nextTenantIds.push('ten_bbbbbbbbbb')
    const other = await f.ws.createWorkspace(t(), { ...NEW, companyName: 'Other Co', adminEmail: 'o@other.test' })
    f.users.set('sup', { tenantId, role: 'supervisor', name: 'S', email: 's@acme.test', status: 'active', mustChangePassword: false, createdAtMs: 1, createdBy: 'x' })
    for (const uid of [other.adminUid, 'sup', 'ghost']) {
      expect((await failure(f.ws.resetTenantAdminCredential(t(), { tenantId, uid })))).toMatchObject({ code: 'not-found', details: { reason: 'user-not-found' } })
    }
    expect((await failure(f.ws.resetTenantAdminCredential(t(), { tenantId: 'nope', uid: 'x' })))?.details?.reason).toBe('workspace-not-found')
    expect(f.revoked).toHaveLength(0)
  })
})

describe('updateTenantAdmin', () => {
  it('renames only (Auth displayName and users doc), audits it, rejects wrong tenant and non-admins', async () => {
    const { tenantId, a } = await seedWorkspace()
    expect(await f.ws.updateTenantAdmin(t(), { tenantId, uid: a, name: 'Ada Lovelace' })).toEqual({ ok: true })
    expect(f.users.get(a)?.name).toBe('Ada Lovelace')
    expect(f.authUsers.get(a)?.displayName).toBe('Ada Lovelace')
    expect(f.users.get(a)?.email).toBe('ada@acme.test')
    expect(f.tenantAudits.at(-1)).toMatchObject({ action: 'user.update', actorRole: 'superadmin' })
    expect(f.audits.at(-1)).toMatchObject({ action: 'admin.updated' })
    f.users.set('sup', { tenantId, role: 'supervisor', name: 'S', email: 's@acme.test', status: 'active', mustChangePassword: false, createdAtMs: 1, createdBy: 'x' })
    expect((await failure(f.ws.updateTenantAdmin(t(), { tenantId, uid: 'sup', name: 'Hack Er' })))?.details?.reason).toBe('user-not-found')
    expect((await failure(f.ws.updateTenantAdmin(t(), { tenantId: 'ten_other', uid: a, name: 'Hack Er' })))?.details?.reason).toBe('workspace-not-found')
    // extra fields (email, role) are not part of the contract
    await f.ws.updateTenantAdmin(t(), { tenantId, uid: a, name: 'Ada L', email: 'x@y.test', role: 'officer' })
    expect(f.users.get(a)).toMatchObject({ email: 'ada@acme.test', role: 'admin' })
  })
})

describe('setTenantAdminStatus', () => {
  it('refuses to disable the last active admin; a second admin can be disabled while another remains', async () => {
    f.nextTenantIds.push('ten_aaaaaaaaaa')
    const { tenantId, adminUid: a } = await f.ws.createWorkspace(t(), NEW)
    expect((await failure(f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'disabled' })))).toMatchObject({ code: 'failed-precondition', details: { reason: 'last-admin' } })
    expect(f.users.get(a)?.status).toBe('active')
    expect(f.authUsers.get(a)?.disabled).toBe(false)
    expect(f.revoked).toHaveLength(0)

    const { adminUid: b } = await f.ws.addTenantAdmin(t(), { tenantId, name: 'Bob B', email: 'bob@acme.test' })
    expect(await f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'disabled' })).toEqual({ ok: true })
    expect(f.users.get(a)?.status).toBe('disabled')
    expect(f.authUsers.get(a)?.disabled).toBe(true)
    expect(f.revoked).toContain(a)
    expect(f.tenantAudits.at(-1)).toMatchObject({ action: 'user.disable', actorRole: 'superadmin', targetId: a })
    expect(f.audits.at(-1)).toMatchObject({ action: 'admin.disabled' })
    // b is now the last active admin
    expect((await failure(f.ws.setTenantAdminStatus(t(), { tenantId, uid: b, status: 'disabled' })))?.details?.reason).toBe('last-admin')
    // a disabled admin does not count as active: re-enabling works and restores the Auth user
    expect(await f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'active' })).toEqual({ ok: true })
    expect(f.users.get(a)?.status).toBe('active')
    expect(f.authUsers.get(a)?.disabled).toBe(false)
    expect(f.tenantAudits.at(-1)).toMatchObject({ action: 'user.enable' })
  })
  it('is a no-op (no audit) when the status already matches, and rejects other tenants and non-admins', async () => {
    const { tenantId, a } = await seedWorkspace()
    const n = f.tenantAudits.length
    await f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'active' })
    expect(f.tenantAudits).toHaveLength(n)
    expect((await failure(f.ws.setTenantAdminStatus(t(), { tenantId, uid: 'ghost', status: 'disabled' })))?.details?.reason).toBe('user-not-found')
    expect((await failure(f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'banned' })))?.details?.reason).toBe('invalid-input')
  })
  it('puts the status back when the Auth update fails after the document changed', async () => {
    const { tenantId, a } = await seedWorkspace()
    f.failures.authUpdate = true
    expect((await failure(f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'disabled' })))?.code).toBe('internal')
    expect(f.users.get(a)?.status).toBe('active')
  })
})

describe('getWorkspace and responses', () => {
  it('returns the summary and admins with first sign-in state, and nothing else', async () => {
    const { tenantId, a, b } = await seedWorkspace()
    f.signIns.set(a, T0 - 1000)
    const res = await f.ws.getWorkspace(t(), { tenantId })
    expect(Object.keys(res).sort()).toEqual(['admins', 'tenant'])
    expect(Object.keys(res.tenant).sort()).toEqual(['createdAt', 'name', 'tenantId', 'timezone', 'userCount', 'vehicleCount'])
    expect(res.admins.map((x) => [x.uid, x.lastSignInAt])).toEqual([[a, T0 - 1000], [b, null]])
    expect(Object.keys(res.admins[0]!).sort()).toEqual(['createdAt', 'email', 'lastSignInAt', 'mustChangePassword', 'name', 'status', 'uid'])
    expect(res.admins[1]).toMatchObject({ mustChangePassword: true, status: 'active' })
    expect((await failure(f.ws.getWorkspace(t(), { tenantId: 'nope' })))?.details?.reason).toBe('workspace-not-found')
  })
  it('no response contains a secret except the one-time temporary password', async () => {
    const { tenantId, a } = await seedWorkspace()
    const responses = [
      await f.ws.getWorkspace(t(), { tenantId }),
      await f.ws.updateTenantAdmin(t(), { tenantId, uid: a, name: 'Ada L' }),
      await f.ws.setTenantAdminStatus(t(), { tenantId, uid: a, status: 'disabled' }).catch(() => ({ ok: false })),
    ]
    const passwords = [...f.authUsers.values()].map((u) => u.password)
    for (const p of passwords) expect(JSON.stringify(responses)).not.toContain(p)
    expect(JSON.stringify(responses)).not.toMatch(/tempPassword|"password"|token|photo|plate|passes|gate|vehicles?\b"?:\s*\[/i)
  })
})

describe('assertTargetIsTenantAdmin', () => {
  it('passes for an admin of the tenant and refuses everything else with the same answer', async () => {
    const { tenantId, a } = await seedWorkspace()
    expect(await assertTargetIsTenantAdmin(f.wsPort, tenantId, a)).toMatchObject({ role: 'admin' })
    f.users.set('off', { tenantId, role: 'officer', name: 'O', email: 'o@acme.test', status: 'active', mustChangePassword: false, createdAtMs: 1, createdBy: 'x' })
    for (const [tid, uid] of [[tenantId, 'off'], [tenantId, 'ghost'], ['ten_zzzzzzzzzz', a]] as const) {
      expect((await failure(assertTargetIsTenantAdmin(f.wsPort, tid, uid)))?.code).toBe('not-found')
    }
  })
})
