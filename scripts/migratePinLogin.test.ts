import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePin, pinKey } from '../functions/src/pin.ts'
import { runScript, type RunDeps } from './lib/env.ts'
import { scriptPepper } from './lib/pinScript.ts'
import { assertOutsideRepo, csvField, migratePinLogin, MigrationError, type Candidate, type MigrateIo } from './migratePinLogin.ts'

const PEPPER = 'test-pepper-0123456789abcdefghijklmnopqrstuvwxyz'
const REPO = process.cwd()

interface FakeWorld {
  io: MigrateIo
  users: Map<string, Candidate & { loginType?: string; [k: string]: unknown }>
  auth: Map<string, { email?: string; password?: string; disabled: boolean; displayName: string; claims?: Record<string, string> }>
  pins: Map<string, { uid: string; tenantId: string; role: string }>
  audits: Record<string, unknown>[]
  lines: string[]
  pinQueue: string[]
}

function world(): FakeWorld {
  const w: FakeWorld = { users: new Map(), auth: new Map(), pins: new Map(), audits: [], lines: [], pinQueue: [], io: undefined as unknown as MigrateIo }
  w.users.set('d1', { uid: 'd1', name: 'Dan', role: 'driver', tenantId: 'T1', contractorId: 'C1', status: 'active' })
  w.users.set('s1', { uid: 's1', name: '=Sam', role: 'security', tenantId: 'T1', contractorId: null, status: 'disabled' })
  w.users.set('s2', { uid: 's2', name: 'Done', role: 'security', tenantId: 'T1', contractorId: null, status: 'active', loginType: 'pin' })
  w.auth.set('d1', { email: '94771234567@drivers.convoypass.com', password: 'x', disabled: false, displayName: 'Dan', claims: { role: 'driver', tenantId: 'T1', contractorId: 'C1' } })
  w.auth.set('s1', { email: 'sam@x.test', password: 'y', disabled: true, displayName: 'Sam', claims: { role: 'security', tenantId: 'T1' } })
  w.io = {
    listCandidates: async () => [...w.users.values()].filter((u) => u.loginType !== 'pin'),
    contractorName: async () => 'Haul Co',
    tenantName: async () => 'Acme Cement',
    replaceAuthUser: async ({ uid, displayName, disabled, claims }) => void w.auth.set(uid, { displayName, disabled, claims }),
    createPinIndex: async (key, entry) => {
      if (w.pins.has(key)) return false
      w.pins.set(key, entry)
      return true
    },
    markMigrated: async (uid, patch, audit) => {
      w.users.set(uid, { ...(w.users.get(uid) as Candidate), ...patch })
      w.audits.push(audit)
    },
    now: () => 1_700_000_000,
    out: (l) => void w.lines.push(l),
    newPin: () => w.pinQueue.shift() ?? generatePin(),
  }
  return w
}

let w: FakeWorld
let dir: string
beforeEach(() => {
  w = world()
  dir = mkdtempSync(join(tmpdir(), 'cp-pins-'))
})

describe('migrate:pin-login', () => {
  it('dry run changes nothing and writes no file', async () => {
    const before = JSON.stringify([[...w.users], [...w.auth], [...w.pins]])
    expect(await migratePinLogin(w.io, { apply: false, out: join(dir, 'pins.csv'), repoRoot: REPO, pepper: PEPPER })).toBe(0)
    expect(JSON.stringify([[...w.users], [...w.auth], [...w.pins]])).toBe(before)
    expect(existsSync(join(dir, 'pins.csv'))).toBe(false)
    expect(w.lines.join('\n')).toMatch(/2 account\(s\)[\s\S]*Dry run/)
  })

  it('--apply keeps the uid and claims, removes email and password, creates pinIndex, audits without the PIN', async () => {
    w.pinQueue = ['48291736', '48291736', '59302847'] // the second person's first PIN collides: retried
    const out = join(dir, 'pins.csv')
    expect(await migratePinLogin(w.io, { apply: true, out, repoRoot: REPO, pepper: PEPPER })).toBe(0)
    expect(w.auth.get('d1')).toEqual({ displayName: 'Dan', disabled: false, claims: { role: 'driver', tenantId: 'T1', contractorId: 'C1' } })
    expect(w.auth.get('s1')).toEqual({ displayName: '=Sam', disabled: true, claims: { role: 'security', tenantId: 'T1' } })
    expect(w.pins.get(pinKey('48291736', PEPPER))).toEqual({ uid: 'd1', tenantId: 'T1', role: 'driver' })
    expect(w.pins.get(pinKey('59302847', PEPPER))).toEqual({ uid: 's1', tenantId: 'T1', role: 'security' })
    expect(w.users.get('d1')).toMatchObject({ loginType: 'pin', mustChangePassword: false, pinVersion: 1 })
    expect(w.audits).toHaveLength(2)
    expect(JSON.stringify(w.audits)).not.toMatch(/48291736|59302847/)
    expect(w.lines.join('\n')).not.toMatch(/4829|5930/)
    expect(w.lines.join('\n')).toContain('DELETE that file')
  })

  it('writes the CSV with mode 0600: name, role, company, PIN (formula-safe)', async () => {
    const out = join(dir, 'pins.csv')
    w.pinQueue = ['48291736', '59302847']
    await migratePinLogin(w.io, { apply: true, out, repoRoot: REPO, pepper: PEPPER })
    expect(statSync(out).mode & 0o777).toBe(0o600)
    const lines = readFileSync(out, 'utf8').trim().split('\r\n')
    expect(lines).toEqual(['name,role,company,pin', 'Dan,driver,Haul Co,4829 1736', "'=Sam,security,Acme Cement,5930 2847"])
  })

  it('refuses --out inside the repository, an existing file, and --apply without --out', async () => {
    await expect(migratePinLogin(w.io, { apply: true, out: join(REPO, 'pins.csv'), repoRoot: REPO, pepper: PEPPER })).rejects.toBeInstanceOf(MigrationError)
    await expect(migratePinLogin(w.io, { apply: true, out: undefined, repoRoot: REPO, pepper: PEPPER })).rejects.toBeInstanceOf(MigrationError)
    expect(w.pins.size).toBe(0)
    expect(() => assertOutsideRepo('scripts/x.csv', REPO)).toThrow(MigrationError)
    expect(assertOutsideRepo(join(dir, 'p.csv'), REPO)).toBe(join(dir, 'p.csv'))
    const out = join(dir, 'pins.csv')
    await migratePinLogin(w.io, { apply: true, out, repoRoot: REPO, pepper: PEPPER })
    w.users.set('d9', { uid: 'd9', name: 'New', role: 'driver', tenantId: 'T1', contractorId: 'C1', status: 'active' })
    await expect(migratePinLogin(w.io, { apply: true, out, repoRoot: REPO, pepper: PEPPER })).rejects.toThrow(/EEXIST/)
  })

  it('is idempotent: migrated accounts are skipped on the next run', async () => {
    w.pinQueue = ['48291736', '59302847']
    await migratePinLogin(w.io, { apply: true, out: join(dir, 'a.csv'), repoRoot: REPO, pepper: PEPPER })
    expect((await w.io.listCandidates()).length).toBe(0)
  })

  it('csvField neutralises formulas and quotes', () => {
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })
})

describe('environment', () => {
  const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
    out: () => undefined, firebaserc: { projects: { staging: 'real-staging-1', prod: 'real-prod-1' } }, emulatorProject: undefined,
    interactive: false, prompt: async () => '', preflight: async () => undefined, ...over,
  })
  it('needs --env (never defaults to production) and refuses prod without confirmation', async () => {
    const run = vi.fn(async () => 0)
    const spec = { name: 'migrate:pin-login', help: '', action: () => 'x', run }
    expect(await runScript(spec, ['--apply'], deps())).toBe(1)
    expect(await runScript(spec, ['--env', 'prod', '--apply', '--out', '/tmp/x.csv'], deps())).toBe(1)
    expect(await runScript(spec, ['--env', 'prod', '--confirm-prod', '--apply'], deps())).toBe(1) // no typed project id
    expect(run).not.toHaveBeenCalled()
    const source = readFileSync('scripts/migrate-pin-login.ts', 'utf8')
    expect(source).toContain("from './lib/env.ts'")
    expect(source).toMatch(/main\(\{/)
  })
  it('staging and prod need PIN_PEPPER from the environment; the emulator uses .secret.local or the dev pepper', () => {
    expect(() => scriptPepper({ env: 'staging', projectId: 'p' }, {})).toThrow(/PIN_PEPPER is required/)
    expect(scriptPepper({ env: 'prod', projectId: 'p' }, { PIN_PEPPER: PEPPER })).toBe(PEPPER)
    expect(scriptPepper({ env: 'emulator', projectId: 'p' }, {}, () => ({ PIN_PEPPER: PEPPER }))).toBe(PEPPER)
    expect(scriptPepper({ env: 'emulator', projectId: 'p' }, {}, () => ({})).length).toBeGreaterThanOrEqual(32)
  })
})
