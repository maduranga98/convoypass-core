// Redaction for the operator audit trail: every platform write path, then a source scan so a new path cannot skip the net.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashInviteCode } from '../tenants/inviteCode.js'
import { platformAudit } from './platformAudit.js'
import { fake, opToken } from './platform-test-utils.js'

describe('platformAuditLog redaction', () => {
  it('no write path stores a code, a full hash, an email, a link or a secret-looking value', async () => {
    const f = fake()
    const t = opToken()
    const a = await f.api.createSetupInvite(t, { companyHint: 'Acme', lockEmail: 'ada@acme.test', expiresInDays: 5 })
    const b = await f.api.createSetupInvite(t, {})
    await f.api.revokeSetupInvite(t, { hashPrefix: b.hashPrefix })
    expect(f.audits.map((x) => x.action)).toEqual(['invite.created', 'invite.created', 'invite.revoked'])
    for (const entry of f.audits) {
      const text = JSON.stringify(entry)
      for (const bad of [a.code, b.code, hashInviteCode(a.code), hashInviteCode(b.code), 'ada@acme.test', 'Acme', 'http', '/setup', 'code=', 'password', 'token']) {
        expect(text, `${entry.action} contains ${bad}`).not.toContain(bad)
      }
      expect(entry.targetRef).toMatch(/^[0-9a-f]{8}$/)
      for (const v of Object.values(entry.meta)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true)
    }
  })
  it('platformAudit runs the same sanitiser as the tenant audit log', () => {
    const e = platformAudit('script', 'operator.created', 'uid1', { password: 'hunter2hunter2', link: 'https://x.test/setup#code=abc', note: 'fine', n: 3 })
    expect(e.meta).toEqual({ password: '[redacted]', link: '[redacted]', note: 'fine', n: 3 })
  })
  it('only platformAudit() builds entries for platformAuditLog', () => {
    // Anything that writes the collection must get its entry from platformAudit() (which sanitises meta).
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]))
    const sources = [...files('src'), ...files('../scripts')].filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))
    const writers = sources.filter((p) => readFileSync(p, 'utf8').includes('platformAuditLog'))
    expect(writers.length).toBeGreaterThan(0)
    for (const p of writers) {
      const text = readFileSync(p, 'utf8')
      const buildsOwn = /platformAuditLog['"`)]*\s*\)\s*\.doc\([^)]*\)\s*\.(set|create)\(\s*\{/.test(text)
      expect(buildsOwn, `${p} writes a raw object to platformAuditLog`).toBe(false)
    }
  })
})
