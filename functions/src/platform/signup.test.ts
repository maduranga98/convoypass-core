import { describe, expect, it } from 'vitest'
import { signUpSuperAdmin, signupStatus, type SignupDeps } from './signup.js'
import type { PlatformAuditEntry } from './platformAudit.js'

const PW = 'Correct-Horse-Battery-9'
const failure = async (p: Promise<unknown>) => p.then(() => null, (e: { code: string; details?: { reason?: string } }) => e)

function world(opts: { enabled?: boolean; taken?: string[]; failDoc?: boolean; authTaken?: string[] } = {}) {
  const users = new Map<string, { email: string; password: string; claims?: unknown; emailVerified: boolean }>()
  const operators = new Map<string, { name: string; email: string }>()
  const audits: PlatformAuditEntry[] = []
  const deleted: string[] = []
  const deps: SignupDeps = {
    enabled: () => opts.enabled ?? true,
    auth: {
      createUser: async (p) => {
        if (opts.authTaken?.includes(p.email)) throw Object.assign(new Error('x'), { code: 'auth/email-already-exists' })
        const uid = `u${users.size + 1}`
        users.set(uid, { email: p.email, password: p.password, emailVerified: p.emailVerified })
        return { uid }
      },
      setCustomUserClaims: async (uid, claims) => void (users.get(uid)!.claims = claims),
      deleteUser: async (uid) => void (users.delete(uid), deleted.push(uid)),
    },
    port: {
      emailInUse: async (e) => (opts.taken ?? []).includes(e),
      createOperator: async (uid, doc, a) => {
        if (opts.failDoc) throw new Error('down')
        operators.set(uid, doc)
        audits.push(a)
      },
    },
  }
  return { deps, users, operators, audits, deleted }
}

describe('open super admin signup', () => {
  it('creates a verified account with exactly the platform claims, an operators profile and an audit entry', async () => {
    const w = world()
    expect(await signUpSuperAdmin(w.deps, { name: ' Olive ', email: 'Olive@ConvoyPass.test', password: PW })).toEqual({ ok: true })
    const [uid, u] = [...w.users.entries()][0]!
    expect(u).toMatchObject({ email: 'olive@convoypass.test', emailVerified: true, claims: { role: 'platform', platformAdmin: true } })
    expect(w.operators.get(uid)).toEqual({ name: 'Olive', email: 'olive@convoypass.test' })
    expect(w.audits).toEqual([{ actorUid: 'signup', action: 'operator.created', targetRef: uid, meta: { source: 'signup' } }])
    expect(JSON.stringify(w.audits) + JSON.stringify([...w.operators.values()])).not.toContain(PW)
  })
  it('is refused while the switch is off, and creates nothing', async () => {
    const w = world({ enabled: false })
    expect((await failure(signUpSuperAdmin(w.deps, { name: 'O', email: 'o@x.test', password: PW })))?.details?.reason).toBe('signup-disabled')
    expect(w.users.size).toBe(0)
    expect(signupStatus(w.deps)).toEqual({ enabled: false })
    expect(signupStatus(world().deps)).toEqual({ enabled: true })
  })
  it('refuses short, common and email-equal passwords', async () => {
    for (const [password, reason] of [['Short-1', 'weak-password'], ['olive@convoypass.test', 'password-is-email'], ['1234567890123', 'weak-password']] as const) {
      const w = world()
      expect((await failure(signUpSuperAdmin(w.deps, { name: 'O', email: 'olive@convoypass.test', password })))?.details?.reason, password).toBe(reason)
      expect(w.users.size).toBe(0)
    }
  })
  it('refuses an email that already has an operators profile, a tenant user or an Auth account', async () => {
    for (const w of [world({ taken: ['o@x.test'] }), world({ authTaken: ['o@x.test'] })]) {
      expect((await failure(signUpSuperAdmin(w.deps, { name: 'O', email: 'o@x.test', password: PW })))?.details?.reason).toBe('email-exists')
      expect(w.operators.size).toBe(0)
    }
  })
  it('validates name and email', async () => {
    const w = world()
    for (const bad of [{ name: '', email: 'o@x.test', password: PW }, { name: 'O', email: 'nope', password: PW }, {}, null]) {
      expect((await failure(signUpSuperAdmin(w.deps, bad)))?.code).toBe('invalid-argument')
    }
    expect(w.users.size).toBe(0)
  })
  it('rolls the Auth user back when the profile cannot be written', async () => {
    const w = world({ failDoc: true })
    expect((await failure(signUpSuperAdmin(w.deps, { name: 'O', email: 'o@x.test', password: PW })))?.code).toBe('internal')
    expect(w.users.size).toBe(0)
    expect(w.deleted).toHaveLength(1)
  })
})
