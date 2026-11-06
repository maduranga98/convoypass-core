import { describe, expect, it } from 'vitest'
import { runDoctor } from './superadminDoctorCli.ts'
import { EMAIL, fakeFirebase } from './superadmin-test-utils.ts'

const base = ['--env', 'emulator', '--email', EMAIL]
const failing = (text: string) => text.split('\n').filter((l) => l.includes('FAIL  ')).map((l) => l.trim())

describe('superadmin:doctor', () => {
  it('a healthy account passes every check and exits 0', async () => {
    const f = fakeFirebase()
    f.healthy()
    expect(await runDoctor(base, f.io)).toBe(0)
    expect(f.text()).toContain('RESULT: PASS')
    expect(f.text()).not.toContain('FAIL')
  })

  const broken: [string, (f: ReturnType<typeof fakeFirebase>) => void, RegExp][] = [
    ['an unknown account', () => undefined, /Auth user exists/],
    ['a missing claim', (f) => void f.healthy({ claims: {} }), /Claims are role 'platform'/],
    ['an extra tenantId claim', (f) => void f.healthy({ claims: { role: 'platform', platformAdmin: true, tenantId: 'ten_1' } }), /No other claims/],
    ['a missing operators profile', (f) => void f.addUser(EMAIL), /operators\/\{uid\} exists/],
    ['a disabled operator', (f) => f.addOperator(f.healthy(), { status: 'disabled' }), /operators\/\{uid\} is active/],
    ['a disabled Auth user', (f) => void f.healthy({ disabled: true }), /not disabled/],
    ['an unverified email', (f) => void f.healthy({ emailVerified: false }), /Email is verified/],
    ['a users document', (f) => f.userDocs.set(f.healthy(), { email: EMAIL }), /No users\/\{uid\} document/],
  ]
  for (const [name, setup, row] of broken) {
    it(`detects ${name} and exits non-zero, with a cause and a fix`, async () => {
      const f = fakeFirebase()
      setup(f)
      expect(await runDoctor(base, f.io)).toBe(1)
      const rows = failing(f.text())
      expect(rows.length).toBeGreaterThanOrEqual(1)
      expect(rows.some((r) => row.test(r))).toBe(true)
      expect(f.text()).toMatch(/likely cause:/)
      expect(f.text()).toMatch(/fix: /)
    })
  }

  it('reports each broken state as its own row (one problem, one FAIL)', async () => {
    for (const [make, expected] of [
      [(f: ReturnType<typeof fakeFirebase>) => void f.healthy({ claims: {} }), 1],
      [(f: ReturnType<typeof fakeFirebase>) => void f.healthy({ emailVerified: false }), 1],
      [(f: ReturnType<typeof fakeFirebase>) => void f.healthy({ claims: { role: 'platform', platformAdmin: true, tenantId: 'x' } }), 1],
    ] as const) {
      const f = fakeFirebase()
      make(f)
      await runDoctor(base, f.io)
      expect(failing(f.text())).toHaveLength(expected)
    }
  })

  it('--fix repairs claims, the verified email, the profile and an extra tenantId, never the password; a second run is clean', async () => {
    const f = fakeFirebase()
    const uid = f.addUser(EMAIL, { claims: { tenantId: 'ten_1' }, emailVerified: false, password: 'pw-keep' })
    expect(await runDoctor([...base, '--fix'], f.io)).toBe(0)
    const u = f.users.get(uid)!
    expect(u.claims).toEqual({ role: 'platform', platformAdmin: true })
    expect(u.emailVerified).toBe(true)
    expect(u.password).toBe('pw-keep')
    expect(f.operators.get(uid)).toBeTruthy()
    expect(f.text()).toMatch(/Fixed:/)
    expect(await runDoctor([...base, '--fix'], f.io)).toBe(0)
  })
  it('--fix leaves what is not fixable alone: a disabled operator, a users document', async () => {
    const f = fakeFirebase()
    const uid = f.healthy({ disabled: true })
    f.addOperator(uid, { status: 'disabled' })
    f.userDocs.set(uid, { email: EMAIL })
    expect(await runDoctor([...base, '--fix'], f.io)).toBe(1)
    expect(f.users.get(uid)!.disabled).toBe(true)
    expect(f.userDocs.has(uid)).toBe(true)
  })

  it('--json prints valid JSON only, with the checks', async () => {
    const f = fakeFirebase()
    f.healthy({ claims: {} })
    expect(await runDoctor([...base, '--json'], f.io)).toBe(1)
    const parsed = JSON.parse(f.text()) as { ok: boolean; checks: { id: string; ok: boolean }[]; email: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.email).toBe(EMAIL)
    expect(parsed.checks.find((c) => c.id === 'claims')?.ok).toBe(false)
    const ok = fakeFirebase()
    ok.healthy()
    expect(await runDoctor([...base, '--json'], ok.io)).toBe(0)
    expect((JSON.parse(ok.text()) as { ok: boolean }).ok).toBe(true)
  })

  it('checks the deployed callable by HTTP outside the emulator (no credentials sent), and skips it on the emulator', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const f = fakeFirebase()
    f.healthy()
    f.io.fetch = async (url, init) => (calls.push({ url, headers: init.headers }), { status: 401 })
    expect(await runDoctor(['--env', 'staging', '--email', EMAIL], f.io)).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://asia-south1-conveypass-staging-1.cloudfunctions.net/getOperatorProfile')
    expect(Object.keys(calls[0]!.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
    expect(f.text()).toMatch(/PASS {2}getOperatorProfile callable is deployed/)

    const emu = fakeFirebase()
    emu.healthy()
    let hit = 0
    emu.io.fetch = async () => (hit++, { status: 401 })
    await runDoctor(base, emu.io)
    expect(hit).toBe(0)

    const missing = fakeFirebase()
    missing.healthy()
    missing.io.fetch = async () => ({ status: 404 })
    expect(await runDoctor(['--env', 'staging', '--email', EMAIL], missing.io)).toBe(1)
    expect(missing.text()).toMatch(/not deployed/)

    const offline = fakeFirebase()
    offline.healthy()
    offline.io.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND') }
    expect(await runDoctor(['--env', 'staging', '--email', EMAIL], offline.io)).toBe(1)
  })
  it('needs --env and --email', async () => {
    const f = fakeFirebase()
    expect(await runDoctor(['--email', EMAIL], f.io)).toBe(1)
    expect(await runDoctor(['--env', 'emulator'], f.io)).toBe(1)
  })
})
