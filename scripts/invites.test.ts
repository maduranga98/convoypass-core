import { describe, expect, it } from 'vitest'
import { hashInviteCode, INVITE_CODE_PATTERN } from '../functions/src/tenants/inviteCode.ts'
import type { PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'
import { runInvitesCli, type CliIo, type InviteStore, type StoredInvite } from './invitesCli.ts'

const NOW = 1_800_000_000_000
const RC = { projects: { default: 'demo', staging: 'conveypass-staging-1', prod: 'conveypass-prod-1' } }

function setup(over: Partial<CliIo> = {}) {
  const docs = new Map<string, StoredInvite>()
  const audits: PlatformAuditEntry[] = []
  const lines: string[] = []
  const store: InviteStore = {
    create: async (h, i, a) => { if (docs.has(h)) throw new Error('exists'); docs.set(h, i); audits.push(a) },
    list: async () => [...docs.entries()].map(([hash, invite]) => ({ hash, invite })),
    delete: async (h, a) => { docs.delete(h); audits.push(a) },
  }
  const io: CliIo = { store, now: () => NOW, out: (l) => lines.push(l), appBaseUrl: 'https://convoypass.com', firebaserc: RC, ...over }
  return { docs, audits, lines, io, text: () => lines.join('\n') }
}
const linkOf = (text: string) => /https?:\/\/\S+\/setup#code=\S+/.exec(text)?.[0] ?? ''

describe('invites create', () => {
  it('prints a link of the right shape once and stores only the hash', async () => {
    const t = setup()
    expect(await runInvitesCli(['create', '--env', 'emulator', '--company', 'Acme Quarry', '--lock-email', ' Ops@Acme.test '], t.io)).toBe(0)
    const link = linkOf(t.text())
    expect(link).toMatch(/^https:\/\/app\.convoypass\.com\/setup#code=[A-Za-z0-9_-]{43}$/)
    expect(link).not.toContain('?')
    const code = link.split('#code=')[1]!
    expect(code).toMatch(INVITE_CODE_PATTERN)
    expect(t.text().split(code)).toHaveLength(2) // the code appears exactly once in the output

    expect([...t.docs.keys()]).toEqual([hashInviteCode(code)])
    const stored = JSON.stringify([...t.docs.entries()])
    expect(stored).not.toContain(code)
    const invite = [...t.docs.values()][0]!
    expect(invite).toMatchObject({ companyHint: 'Acme Quarry', emailLock: 'ops@acme.test', claimedAtMs: null, usedAtMs: null, tenantId: null })
    expect(invite.expiresAtMs - invite.createdAtMs).toBe(7 * 86_400_000) // default 7 days
    expect(t.text()).toMatch(/secure channel/i)
    // The operator audit trail (Module 9) records the script as the actor, with the prefix only.
    expect(t.audits).toEqual([{ actorUid: 'script', action: 'invite.created', targetRef: hashInviteCode(code).slice(0, 8), meta: { expiresInDays: 7, locked: true, hasCompanyHint: true, source: 'script', env: 'emulator' } }])
    expect(JSON.stringify(t.audits)).not.toContain(code)
  })
  it('enforces 1-30 whole days', async () => {
    for (const days of ['0', '31', '1.5', 'abc', '-3']) {
      const t = setup()
      expect(await runInvitesCli(['create', '--env', 'emulator', '--expires-days', days], t.io), days).toBe(1)
      expect(t.docs.size).toBe(0)
      expect(t.text()).toMatch(/expires-days/)
    }
    for (const days of ['1', '30']) {
      const t = setup()
      expect(await runInvitesCli(['create', '--env', 'emulator', '--expires-days', days], t.io)).toBe(0)
      expect([...t.docs.values()][0]!.expiresAtMs - NOW).toBe(Number(days) * 86_400_000)
    }
  })
  it('rejects a bad lock email and needs APP_BASE_URL (https outside the emulator)', async () => {
    let t = setup()
    expect(await runInvitesCli(['create', '--env', 'emulator', '--lock-email', 'nope'], t.io)).toBe(1)
    t = setup({ appBaseUrl: undefined })
    expect(await runInvitesCli(['create', '--env', 'emulator'], t.io)).toBe(1)
    expect(t.text()).toMatch(/APP_BASE_URL/)
    t = setup({ appBaseUrl: 'http://convoypass.com' })
    expect(await runInvitesCli(['create', '--env', 'staging'], t.io)).toBe(1)
    t = setup({ appBaseUrl: 'http://localhost:5173' })
    expect(await runInvitesCli(['create', '--env', 'emulator'], t.io)).toBe(0)
    expect(linkOf(t.text())).toMatch(/^http:\/\/localhost:5173\/setup#code=/)
    expect(t.docs.size).toBe(1)
  })
  it('refuses production without --confirm-prod and before touching the store', async () => {
    const t = setup()
    t.io.store = { create: () => { throw new Error('store touched') }, list: () => { throw new Error('store touched') }, delete: () => { throw new Error('store touched') } }
    for (const cmd of ['create', 'list']) {
      expect(await runInvitesCli([cmd, '--env', 'prod'], t.io)).toBe(1)
    }
    expect(t.text()).toMatch(/--confirm-prod/)
    expect(await runInvitesCli(['create'], t.io)).toBe(1) // no --env at all
    const ok = setup()
    expect(await runInvitesCli(['create', '--env', 'prod', '--confirm-prod'], ok.io)).toBe(0)
  })
  it('refuses a placeholder project for staging', async () => {
    const t = setup({ firebaserc: { projects: { staging: 'replace-with-staging-id' } } })
    expect(await runInvitesCli(['create', '--env', 'staging'], t.io)).toBe(1)
  })
})

describe('invites list and revoke', () => {
  const seed = (t: ReturnType<typeof setup>) => {
    const mk = (over: Partial<StoredInvite>): StoredInvite => ({ createdAtMs: NOW - 1000, expiresAtMs: NOW + 86_400_000, claimedAtMs: null, usedAtMs: null, tenantId: null, ...over })
    t.docs.set('1'.repeat(64), mk({ companyHint: 'Unused Co' }))
    t.docs.set('2'.repeat(64), mk({ companyHint: 'Claimed Co', claimedAtMs: NOW - 60_000 }))
    t.docs.set('3'.repeat(64), mk({ companyHint: 'Used Co', usedAtMs: NOW - 5000, tenantId: 'ten_abcde12345' }))
    t.docs.set('4'.repeat(64), mk({ companyHint: 'Expired Co', expiresAtMs: NOW - 1 }))
  }
  it('lists prefix, hint, status and expiry, and never a full hash or a code', async () => {
    const t = setup()
    seed(t)
    expect(await runInvitesCli(['list', '--env', 'emulator'], t.io)).toBe(0)
    const text = t.text()
    for (const [prefix, status, hint] of [['11111111', 'unused', 'Unused Co'], ['22222222', 'claimed', 'Claimed Co'], ['33333333', 'used', 'Used Co'], ['44444444', 'expired', 'Expired Co']]) {
      expect(text).toMatch(new RegExp(`${prefix}\\t${status}\\t[\\d-]+ [\\d:]+\\t${hint}`))
    }
    expect(text).not.toContain('1'.repeat(9))
  })
  it('revoke deletes an unused invite but refuses a used one', async () => {
    const t = setup()
    seed(t)
    expect(await runInvitesCli(['revoke', '--env', 'emulator', '11111111'], t.io)).toBe(0)
    expect(t.docs.has('1'.repeat(64))).toBe(false)
    expect(t.audits).toEqual([{ actorUid: 'script', action: 'invite.revoked', targetRef: '11111111', meta: { source: 'script', env: 'emulator' } }])
    expect(await runInvitesCli(['revoke', '--env', 'emulator', '33333333'], t.io)).toBe(1)
    expect(t.audits).toHaveLength(1) // a refused revoke is not audited as a revoke
    expect(t.docs.has('3'.repeat(64))).toBe(true)
    expect(t.text()).toMatch(/already used/)
  })
  it('revoke needs an unambiguous prefix of at least 8 hex characters that exists', async () => {
    const t = setup()
    seed(t)
    t.docs.set('1' + '2'.repeat(63), { createdAtMs: 0, expiresAtMs: NOW + 1, claimedAtMs: null, usedAtMs: null, tenantId: null })
    for (const args of [['abc'], ['zzzzzzzz'], ['99999999'], []]) expect(await runInvitesCli(['revoke', '--env', 'emulator', ...args], t.io), args.join()).toBe(1)
    expect(t.docs.size).toBe(5)
  })
  it('prints usage for an unknown command', async () => {
    const t = setup()
    expect(await runInvitesCli(['frobnicate', '--env', 'emulator'], t.io)).toBe(1)
  })
})
