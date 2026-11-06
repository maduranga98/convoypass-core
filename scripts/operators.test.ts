import { describe, expect, it } from 'vitest'
import { DEV_SUPERADMIN, OPERATOR_CLAIMS, runCreateOperator, runDevSuperadmin, runDisableOperator } from './operatorsCli.ts'
import { EMAIL, fakeFirebase } from './superadmin-test-utils.ts'

const STRONG = 'Tr0ub4dor&3-horse-staple'
const PW = 'Gen3rated-Pass-9876-XyZ'
const args = (...a: string[]) => ['--env', 'emulator', ...a]
const create = (...a: string[]) => args('--email', EMAIL, '--name', 'Olive', ...a)

describe('superadmin:create (new account)', () => {
  it('creates the exact claims, the operators profile and a verified email, then passes its own readback', async () => {
    const f = fakeFirebase()
    expect(await runCreateOperator(create(), f.io)).toBe(0)
    const u = [...f.users.values()][0]!
    expect(u.email).toBe(EMAIL)
    expect(u.emailVerified).toBe(true)
    expect(u.claims).toEqual({ role: 'platform', platformAdmin: true })
    expect(OPERATOR_CLAIMS).not.toHaveProperty('tenantId')
    expect(f.operators.get(u.uid)).toMatchObject({ name: 'Olive', email: EMAIL, status: 'active', mustChangePassword: true })
    expect(f.audits).toEqual([{ actorUid: 'script', action: 'operator.created', targetRef: u.uid, meta: { env: 'emulator' } }])
    expect(f.text()).toContain('RESULT: PASS')
    expect(f.text()).not.toContain('FAIL')
  })
  it('prints the generated password once, apart from the log, and it is nowhere else', async () => {
    const f = fakeFirebase()
    expect(await runCreateOperator(create(), f.io)).toBe(0)
    expect(f.secretText().split(PW)).toHaveLength(2) // exactly once
    expect(f.text()).not.toContain(PW) // not in the log lines
    expect(f.persisted()).not.toContain(PW) // not in audit entries, the profile or the Auth profile
    expect([...f.users.values()][0]!.password).toBe(PW) // it is only the Auth credential
  })
  it('prints the sign-in URL, the doctor command and the MFA reminder', async () => {
    const f = fakeFirebase()
    await runCreateOperator(args('--email', EMAIL, '--name', 'O'), f.io)
    expect(f.text()).toContain('https://app.convoypass.test/platform/login')
    expect(f.text()).toContain('superadmin:doctor')
    expect(f.text()).toMatch(/MFA/)
  })
  it('--password is rejected with an explanation and nothing is created', async () => {
    const f = fakeFirebase()
    expect(await runCreateOperator(create('--password', STRONG), f.io)).toBe(1)
    expect(f.text()).toMatch(/shell history/)
    expect(f.text()).not.toContain(STRONG)
    expect(f.users.size).toBe(0)
    expect(f.touched()).toBe(0)
  })
  it('--password-stdin: accepts a strong password (no forced change) and never echoes it', async () => {
    const f = fakeFirebase({ stdin: STRONG })
    expect(await runCreateOperator(create('--password-stdin'), f.io)).toBe(0)
    const u = [...f.users.values()][0]!
    expect(u.password).toBe(STRONG)
    expect(f.operators.get(u.uid)?.mustChangePassword).toBe(false)
    expect(f.text() + f.secretText() + f.persisted()).not.toContain(STRONG)
  })
  it('--password-stdin rejects weak passwords: under 14 characters, the email itself, common ones', async () => {
    for (const pw of ['Short-1', '1234567890123', EMAIL]) {
      const f = fakeFirebase({ stdin: pw })
      expect(await runCreateOperator(create('--password-stdin'), f.io), pw).toBe(1)
      expect(f.users.size).toBe(0)
      expect(f.text()).toMatch(/password/)
    }
    const ok = fakeFirebase({ stdin: 'Fourteen-chars-' })
    expect(await runCreateOperator(create('--password-stdin'), ok.io)).toBe(0)
  })
  it('refuses an email that belongs to a tenant user (users doc, tenant claim, or an orphaned users doc)', async () => {
    const withDoc = fakeFirebase()
    const uid = withDoc.addUser(EMAIL, { claims: {} })
    withDoc.userDocs.set(uid, { email: EMAIL })
    expect(await runCreateOperator(create('--repair'), withDoc.io)).toBe(1)
    expect(withDoc.text()).toMatch(/tenant user/)
    expect(withDoc.users.get(uid)!.claims).toEqual({}) // not promoted

    const withClaim = fakeFirebase()
    const u2 = withClaim.addUser(EMAIL, { claims: { role: 'admin', tenantId: 'ten_1' } })
    expect(await runCreateOperator(create('--repair'), withClaim.io)).toBe(1)
    expect(withClaim.users.get(u2)!.claims).toEqual({ role: 'admin', tenantId: 'ten_1' })

    const orphan = fakeFirebase()
    orphan.userDocs.set('gone', { email: EMAIL })
    expect(await runCreateOperator(create(), orphan.io)).toBe(1)
    expect(orphan.users.size).toBe(0)
  })
  it('rerun without a flag refuses and changes nothing', async () => {
    const f = fakeFirebase()
    f.healthy()
    expect(await runCreateOperator(create(), f.io)).toBe(1)
    expect(f.text()).toContain('Account exists. Use --repair to fix its setup or --reset-password to issue a new temporary password')
    expect(f.audits).toHaveLength(0)
  })
  it('requires --env, and production needs --confirm-prod, before touching anything', async () => {
    const f = fakeFirebase()
    expect(await runCreateOperator(['--email', EMAIL, '--name', 'O'], f.io)).toBe(1)
    expect(await runCreateOperator(['--env', 'prod', '--email', EMAIL, '--name', 'O'], f.io)).toBe(1)
    expect(f.text()).toMatch(/--confirm-prod/)
    expect(f.touched()).toBe(0)
    expect(await runCreateOperator(['--env', 'prod', '--confirm-prod', '--email', EMAIL, '--name', 'O'], f.io)).toBe(0)
    expect(f.audits[0]!.meta).toEqual({ env: 'prod' })
  })
  it('validates the email and the name, and the flag combinations', async () => {
    expect(await runCreateOperator(args('--email', 'nope', '--name', 'O'), fakeFirebase().io)).toBe(1)
    expect(await runCreateOperator(args('--email', EMAIL), fakeFirebase().io)).toBe(1)
    expect(await runCreateOperator(create('--repair', '--reset-password'), fakeFirebase().io)).toBe(1)
    const f = fakeFirebase({ stdin: STRONG })
    f.healthy()
    expect(await runCreateOperator(create('--repair', '--password-stdin'), f.io)).toBe(1)
    expect(await runCreateOperator(create('--reset-password', '--password-stdin'), f.io)).toBe(1)
  })
  it('--repair on an address with no account says so', async () => {
    const f = fakeFirebase()
    expect(await runCreateOperator(create('--repair'), f.io)).toBe(1)
    expect(f.text()).toMatch(/no account/)
  })
  it('rolls the Auth user back when the operators profile cannot be written', async () => {
    const f = fakeFirebase({ failOperatorDoc: true })
    expect(await runCreateOperator(create(), f.io)).toBe(1)
    expect(f.deleted).toHaveLength(1)
    expect(f.users.size).toBe(0)
  })
})

describe('superadmin:create --repair', () => {
  it('restores missing claims, a missing profile and an unverified email without changing the password', async () => {
    const f = fakeFirebase()
    const uid = f.addUser(EMAIL, { claims: {}, emailVerified: false, password: 'pw-secret-hash' })
    expect(await runCreateOperator(create('--repair'), f.io)).toBe(0)
    const u = f.users.get(uid)!
    expect(u.claims).toEqual({ role: 'platform', platformAdmin: true })
    expect(u.emailVerified).toBe(true)
    expect(u.password).toBe('pw-secret-hash')
    expect(f.operators.get(uid)).toMatchObject({ email: EMAIL, status: 'active' })
    expect(f.audits.map((a) => a.action)).toEqual(['operator.repaired'])
    expect(f.text()).toContain('RESULT: PASS')
    expect(f.secretText()).toBe('')
  })
  it('removes an extra tenantId claim and is idempotent', async () => {
    const f = fakeFirebase()
    const uid = f.healthy({ claims: { role: 'platform', platformAdmin: true, tenantId: 'ten_1' } })
    expect(await runCreateOperator(create('--repair'), f.io)).toBe(0)
    expect(f.users.get(uid)!.claims).toEqual({ role: 'platform', platformAdmin: true })
    const auditsBefore = f.audits.length
    expect(await runCreateOperator(create('--repair'), f.io)).toBe(0)
    expect(f.text()).toContain('nothing needed changing')
    expect(f.audits).toHaveLength(auditsBefore)
  })
  it('does not re-enable a disabled account unless --enable is given', async () => {
    const f = fakeFirebase()
    const uid = f.healthy({ disabled: true })
    f.addOperator(uid, { status: 'disabled' })
    expect(await runCreateOperator(create('--repair'), f.io)).toBe(1) // still FAIL: it is disabled
    expect(f.users.get(uid)!.disabled).toBe(true)
    expect(await runCreateOperator(create('--repair', '--enable'), f.io)).toBe(0)
    expect(f.users.get(uid)!.disabled).toBe(false)
    expect(f.operators.get(uid)!.status).toBe('active')
  })
})

describe('superadmin:create --reset-password', () => {
  it('sets a new temporary password, revokes tokens, forces a change, prints it once and audits without it', async () => {
    const f = fakeFirebase({ generated: 'N3w-Temp-Passw0rd-Qz' })
    const uid = f.healthy()
    expect(await runCreateOperator(create('--reset-password'), f.io)).toBe(0)
    expect(f.users.get(uid)!.password).toBe('N3w-Temp-Passw0rd-Qz')
    expect(f.revoked).toEqual([uid])
    expect(f.operators.get(uid)!.mustChangePassword).toBe(true)
    expect(f.audits.map((a) => a.action)).toEqual(['operator.passwordReset'])
    expect(f.secretText().split('N3w-Temp-Passw0rd-Qz')).toHaveLength(2)
    expect(f.text() + f.persisted()).not.toContain('N3w-Temp-Passw0rd-Qz')
  })
})

describe('superadmin:disable', () => {
  it('disables the Auth user, revokes tokens, marks the profile and audits', async () => {
    const f = fakeFirebase()
    const uid = f.healthy()
    expect(await runDisableOperator(args('--email', EMAIL.toUpperCase()), f.io)).toBe(0)
    expect(f.users.get(uid)!.disabled).toBe(true)
    expect(f.revoked).toEqual([uid])
    expect(f.operators.get(uid)?.status).toBe('disabled')
    expect(f.audits).toEqual([{ actorUid: 'script', action: 'operator.disabled', targetRef: uid, meta: { env: 'emulator' } }])
  })
  it('refuses anyone who is not an operator (a tenant user is never disabled by this script)', async () => {
    const f = fakeFirebase()
    f.addUser('admin@acme.test', { claims: { role: 'admin', tenantId: 't' } })
    expect(await runDisableOperator(args('--email', 'admin@acme.test'), f.io)).toBe(1)
    expect(await runDisableOperator(args('--email', 'ghost@x.test'), f.io)).toBe(1)
    expect(f.revoked).toHaveLength(0)
  })
  it('refuses production without --confirm-prod', async () => {
    const f = fakeFirebase()
    f.healthy()
    expect(await runDisableOperator(['--env', 'prod', '--email', EMAIL], f.io)).toBe(1)
    expect(f.touched()).toBe(0)
  })
})

describe('dev:superadmin', () => {
  it('creates the fixed dev account, then repairs it and restores the dev password', async () => {
    const f = fakeFirebase()
    expect(await runDevSuperadmin(['--env', 'emulator'], f.io)).toBe(0)
    const u = [...f.users.values()][0]!
    expect(u.email).toBe(DEV_SUPERADMIN.email)
    expect(u.password).toBe(DEV_SUPERADMIN.password)
    expect(f.operators.get(u.uid)!.mustChangePassword).toBe(false)
    expect(f.text()).toMatch(/DEV ONLY/)

    u.claims = {}
    u.password = 'changed'
    f.operators.delete(u.uid)
    expect(await runDevSuperadmin(['--env', 'emulator'], f.io)).toBe(0)
    expect(u.claims).toEqual({ role: 'platform', platformAdmin: true })
    expect(u.password).toBe(DEV_SUPERADMIN.password)
    expect(f.operators.get(u.uid)).toBeTruthy()
  })
  it('hard-fails for staging and prod', async () => {
    for (const a of [['--env', 'staging'], ['--env', 'prod', '--confirm-prod'], []]) {
      const f = fakeFirebase()
      expect(await runDevSuperadmin(a, f.io)).toBe(1)
      expect(f.users.size).toBe(0)
    }
  })
})
