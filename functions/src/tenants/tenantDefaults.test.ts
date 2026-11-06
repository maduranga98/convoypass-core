import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHECKLIST, DEFAULT_PASS_SETTINGS } from '../defaultChecklist.js'
import { DEFAULT_REJECTION_REASONS } from '../defaultRejectionReasons.js'
import { DEFAULT_SLA } from '../defaultSla.js'
import { DEFAULT_EXPIRY_WARNING_DAYS } from '../expiry.js'
import { DEFAULT_GATES } from '../gates.js'
import { VEHICLE_TYPES } from '../vehicleTypes.js'
import { buildTenantDocs, DEFAULT_TIMEZONE, newTenantId, provisionTenant, tenantDefaults, TENANT_ID_PATTERN } from './tenantDefaults.js'

const STAMP = { serverTimestamp: true }
const input = {
  tenantId: 'ten_abcde12345', tenantName: 'Acme', timezone: 'Asia/Colombo',
  admin: { uid: 'u1', name: 'Ada', email: 'ada@acme.test', mustChangePassword: false, createdBy: 'setup' },
  actor: { uid: 'setup', role: 'system' as const }, createdAt: STAMP,
}

describe('tenant defaults', () => {
  it('contains every field later modules read, equal to the constants those modules fall back to', () => {
    const d = tenantDefaults()
    expect(d).toEqual({
      timezone: 'Asia/Colombo',
      checklist: [...DEFAULT_CHECKLIST],
      rejectionReasons: [...DEFAULT_REJECTION_REASONS],
      gates: [...DEFAULT_GATES],
      sla: DEFAULT_SLA,
      passSettings: DEFAULT_PASS_SETTINGS,
      retentionDays: 0,
      vehicleTypes: [...VEHICLE_TYPES],
      expiryWarningDays: DEFAULT_EXPIRY_WARNING_DAYS,
      autoIssueGatePasses: false,
    })
    expect(DEFAULT_TIMEZONE).toBe('Asia/Colombo')
  })
  it('hands out copies: mutating one never changes the shared constants', () => {
    const d = tenantDefaults()
    d.checklist[0]!.label = 'x'
    d.gates.push({ id: 'x', name: 'x' })
    expect(DEFAULT_CHECKLIST[0]!.label).not.toBe('x')
    expect(DEFAULT_GATES).toHaveLength(1)
  })
  it('generates ten_ + 10 [a-z0-9] ids', () => {
    for (let i = 0; i < 50; i++) expect(newTenantId()).toMatch(TENANT_ID_PATTERN)
    expect(new Set(Array.from({ length: 50 }, newTenantId)).size).toBe(50)
  })
})

describe('provisionTenant', () => {
  it('builds an active tenant with all defaults, an active admin user and two audit entries', () => {
    const { tenant, user, audits } = buildTenantDocs(input)
    expect(tenant).toMatchObject({ name: 'Acme', status: 'active', ...tenantDefaults(), createdAt: STAMP })
    expect(user).toMatchObject({
      tenantId: 'ten_abcde12345', role: 'admin', contractorId: null, name: 'Ada', email: 'ada@acme.test', phone: null,
      status: 'active', mustChangePassword: false, createdBy: 'setup',
    })
    expect(audits.map((a) => [a.action, a.targetType, a.targetId, a.actorRole])).toEqual([
      ['tenant.created', 'tenant', 'ten_abcde12345', 'system'],
      ['user.created', 'user', 'u1', 'system'],
    ])
    expect(JSON.stringify(audits)).not.toMatch(/passw|token/i)
  })
  it('writes everything through create() on one writer, so an existing tenant or user can never be overwritten', () => {
    const created: { ref: unknown; data: Record<string, unknown> }[] = []
    let n = 0
    const db = { doc: (p: string) => `doc:${p}`, collection: (p: string) => ({ doc: () => `${p}/auto${++n}` }) }
    provisionTenant(db, { create: (ref, data) => created.push({ ref, data }) }, input)
    expect(created.map((c) => c.ref)).toEqual(['doc:tenants/ten_abcde12345', 'doc:users/u1', 'auditLog/auto1', 'auditLog/auto2'])
  })
  it('is the only writer of tenant defaults: setup, create-tenant, seed and seed-demo all use it', () => {
    const read = (p: string) => readFileSync(join(__dirname, p), 'utf8')
    expect(read('../setup.ts')).toMatch(/provisionTenant/)
    for (const f of ['create-tenant', 'seed']) {
      const src = read(`../../../scripts/${f}.ts`)
      expect(src, f).toMatch(/provisionTenant\(/)
      expect(src, f).not.toMatch(/batch\.create\(tenantRef/)
    }
    expect(read('../../../scripts/seed-demo.ts')).toMatch(/tenantDefaults\(/)
  })
})
