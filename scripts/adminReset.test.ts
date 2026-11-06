import { describe, expect, it } from 'vitest'
import { randomTempPassword, runAdminReset, type AdminResetIo } from './adminResetCli.ts'
import { isCommonPassword } from '../src/lib/commonPasswords.ts'

const RC = { projects: { staging: 'conveypass-staging-1', prod: 'conveypass-prod-1' } }

function setup(role: string | null = 'admin', over: Partial<AdminResetIo> = {}) {
  const calls: string[] = []
  const audits: unknown[] = []
  const lines: string[] = []
  const io: AdminResetIo = {
    auth: {
      getUserByEmail: async (email) => (email === 'admin@acme.test' ? { uid: 'u1' } : null),
      generatePasswordResetLink: async (email, url) => { calls.push(`link:${email}:${url ?? ''}`); return 'https://example.test/__/auth/action?mode=resetPassword&oobCode=SECRET' },
      updatePassword: async (uid, p) => void calls.push(`password:${uid}:${p.length}`),
      revokeRefreshTokens: async (uid) => void calls.push(`revoke:${uid}`),
    },
    db: {
      getUser: async () => (role ? { role, tenantId: 'ten_1', status: 'active' } : null),
      requireChangeAtNextLogin: async (uid) => void calls.push(`mustChange:${uid}`),
      writeAudit: async (e) => void audits.push(e),
    },
    out: (l) => lines.push(l), firebaserc: RC, appBaseUrl: 'https://convoypass.com', randomPassword: () => 'Tmp-Passw0rd-Xk', ...over,
  }
  return { io, calls, audits, text: () => lines.join('\n') }
}
const ARGS = ['--env', 'staging', '--email', 'admin@acme.test']

describe('admin:reset', () => {
  it('--link prints a reset link with the app login as continue URL, writes the audit entry, changes nothing else', async () => {
    const t = setup()
    expect(await runAdminReset([...ARGS, '--link'], t.io)).toBe(0)
    expect(t.calls).toEqual(['link:admin@acme.test:https://convoypass.com/login/staff'])
    expect(t.text()).toContain('oobCode=SECRET')
    expect(t.audits).toEqual([{
      tenantId: 'ten_1', action: 'admin.recovery', actorUid: 'admin-reset', actorRole: 'system', targetType: 'user', targetId: 'u1', meta: { method: 'link', env: 'staging' },
    }])
    expect(JSON.stringify(t.audits)).not.toContain('SECRET')
  })
  it('--temp-password sets it, revokes sessions, forces a change, prints it once and audits without the secret', async () => {
    const t = setup()
    expect(await runAdminReset([...ARGS, '--temp-password'], t.io)).toBe(0)
    expect(t.calls).toEqual(['password:u1:15', 'revoke:u1', 'mustChange:u1'])
    expect(t.text().split('Tmp-Passw0rd-Xk')).toHaveLength(2)
    expect(JSON.stringify(t.audits)).not.toContain('Tmp-Passw0rd')
    expect(t.audits).toMatchObject([{ action: 'admin.recovery', meta: { method: 'temp-password', env: 'staging' } }])
  })
  it('refuses non-admins, missing users and users without a profile, and changes nothing', async () => {
    for (const role of ['supervisor', 'officer', 'driver', 'security', null]) {
      const t = setup(role)
      expect(await runAdminReset([...ARGS, '--temp-password'], t.io), String(role)).toBe(1)
      expect(t.calls).toEqual([])
      expect(t.audits).toEqual([])
      expect(t.text()).toMatch(/not an admin/)
    }
    const t = setup()
    expect(await runAdminReset(['--env', 'staging', '--email', 'ghost@acme.test', '--link'], t.io)).toBe(1)
    expect(t.calls).toEqual([])
  })
  it('refuses production without --confirm-prod, and works with it', async () => {
    const t = setup()
    expect(await runAdminReset(['--env', 'prod', '--email', 'admin@acme.test', '--link'], t.io)).toBe(1)
    expect(t.text()).toMatch(/--confirm-prod/)
    expect(t.calls).toEqual([])
    expect(await runAdminReset(['--env', 'prod', '--confirm-prod', '--email', 'admin@acme.test', '--link'], t.io)).toBe(0)
    expect(t.audits).toMatchObject([{ meta: { env: 'prod' } }])
  })
  it('needs exactly one of --link / --temp-password and an email', async () => {
    for (const extra of [[], ['--link', '--temp-password']]) {
      const t = setup()
      expect(await runAdminReset([...ARGS, ...extra], t.io)).toBe(1)
      expect(t.calls).toEqual([])
    }
    expect(await runAdminReset(['--env', 'staging', '--link'], setup().io)).toBe(1)
  })
  it('random temporary passwords are 16 characters, never common, with upper, lower and digits', () => {
    for (let i = 0; i < 200; i++) {
      const p = randomTempPassword()
      expect(p).toMatch(/^[A-Za-z0-9]{16}$/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/\d/)
      expect(isCommonPassword(p)).toBe(false)
    }
  })
})
