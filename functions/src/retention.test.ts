import { beforeEach, describe, expect, it } from 'vitest'
import { cutoffKey, PURGE_MAX_PASSES_PER_RUN, purgeOldEvidence, type RetentionPort } from './retention.js'
import { updateTenantSettings } from './passes.js'
import { admin, makeWorld, rejects, sup1 } from './test-utils.js'
import type { AuditEntry, PassData, TenantData } from './types.js'

const NOW_MS = Date.parse('2026-03-10T08:00:00Z') // 2026-03-10 13:30 in Colombo
const DAY = 86_400_000
const key = (daysAgo: number) => {
  const d = new Date(NOW_MS - daysAgo * DAY)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

interface Store {
  tenants: Map<string, TenantData & { retentionCursor?: string }>
  passes: Map<string, PassData>
  /** objects in "Storage": path prefixes per pass */
  files: Set<string>
  audits: AuditEntry[]
  failOn: Set<string>
  port: RetentionPort
}

const makeStore = (): Store => {
  const s: Store = {
    tenants: new Map(), passes: new Map(), files: new Set(), audits: [], failOn: new Set(), port: undefined as unknown as RetentionPort,
  }
  s.port = {
    listTenants: async () => [...s.tenants].map(([id, data]) => ({ id, data: structuredClone(data) })),
    listPassesBetween: async ({ tenantId, afterKey, beforeKey, limit }) =>
      [...s.passes]
        .filter(([, p]) => p.tenantId === tenantId && (!afterKey || p.dateKey > afterKey) && p.dateKey < beforeKey)
        .sort((a, b) => a[1].dateKey.localeCompare(b[1].dateKey) || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([id, p]) => ({ id, pass: structuredClone(p) })),
    deleteEvidence: async (tenantId, vehicleId, dateKey) => {
      const prefix = `tenants/${tenantId}/passes/${vehicleId}/${dateKey}/`
      if (s.failOn.has(`${vehicleId}_${dateKey}`)) throw new Error('storage down')
      const hit = [...s.files].filter((f) => f.startsWith(prefix))
      hit.forEach((f) => s.files.delete(f))
      return hit.length
    },
    markEvidenceDeleted: async (id) => void s.passes.set(id, { ...(s.passes.get(id) as PassData), evidenceDeletedAt: NOW_MS }),
    setCursor: async (tenantId, k) => void s.tenants.set(tenantId, { ...(s.tenants.get(tenantId) as TenantData), retentionCursor: k }),
    writeAudit: async (a) => void s.audits.push(a),
  }
  return s
}

let s: Store
beforeEach(() => {
  s = makeStore()
})

const addPass = (id: string, daysAgo: number, tenantId = 'T1') => {
  const vehicleId = id
  const dateKey = key(daysAgo)
  s.passes.set(`${vehicleId}_${dateKey}`, {
    tenantId, contractorId: 'C1', vehicleId, plateNo: 'X', vehicleType: 'Tipper', dateKey, driverId: 'd', driverName: 'D', status: 'checked_in', attempt: 1,
    submittedAt: 1, checklist: [], evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } }, history: [{ action: 'check_in', stage: 'gate', byUid: 'sec', byName: 'S', byRole: 'security', at: 1, attempt: 1 }],
  })
  for (const f of ['1/gps.jpg', '1/dashcam.jpg']) s.files.add(`tenants/${tenantId}/passes/${vehicleId}/${dateKey}/${f}`)
  return `${vehicleId}_${dateKey}`
}

describe('purgeOldEvidence', () => {
  it('does nothing at all when retentionDays is 0 or absent (the default)', async () => {
    addPass('veh_old', 400)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 0 })
    s.tenants.set('T2', {})
    expect(await purgeOldEvidence(s.port, NOW_MS)).toMatchObject({ tenants: 0, passes: 0, files: 0 })
    expect(s.files.size).toBe(2)
    expect([...s.passes.values()].every((p) => p.evidenceDeletedAt === undefined)).toBe(true)
    expect(s.audits).toEqual([])
  })

  it('ignores values below the 30-day minimum rather than honouring them', async () => {
    addPass('veh_old', 400)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 5 })
    await purgeOldEvidence(s.port, NOW_MS)
    expect(s.files.size).toBe(2)
  })

  it('removes the evidence of passes older than the cutoff only', async () => {
    const old = addPass('veh_old', 100)
    const edge = addPass('veh_edge', 91)
    const kept = addPass('veh_kept', 89)
    const today = addPass('veh_today', 0)
    const other = addPass('veh_other', 400, 'T2')
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    s.tenants.set('T2', { timezone: 'Asia/Colombo', retentionDays: 0 })
    const summary = await purgeOldEvidence(s.port, NOW_MS)
    expect(summary).toMatchObject({ tenants: 1, passes: 2, files: 4, failed: 0 })
    expect(s.passes.get(old)?.evidenceDeletedAt).toBe(NOW_MS)
    expect(s.passes.get(edge)?.evidenceDeletedAt).toBe(NOW_MS)
    expect(s.passes.get(kept)?.evidenceDeletedAt).toBeUndefined()
    expect(s.passes.get(today)?.evidenceDeletedAt).toBeUndefined()
    expect(s.passes.get(other)?.evidenceDeletedAt).toBeUndefined() // another tenant, retention off
    expect([...s.files].filter((f) => f.includes('veh_kept') || f.includes('veh_today') || f.includes('veh_other'))).toHaveLength(6)
    expect([...s.files].some((f) => f.includes('veh_old') || f.includes('veh_edge'))).toBe(false)
  })

  it('keeps the pass documents and their history', async () => {
    const id = addPass('veh_old', 200)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 30 })
    await purgeOldEvidence(s.port, NOW_MS)
    const p = s.passes.get(id) as PassData
    expect(p).toMatchObject({ status: 'checked_in', plateNo: 'X', history: [{ action: 'check_in' }], evidenceDeletedAt: NOW_MS })
  })

  it('writes one audit entry per tenant and run with the counts', async () => {
    addPass('veh_a', 100)
    addPass('veh_b', 101)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    await purgeOldEvidence(s.port, NOW_MS)
    expect(s.audits).toHaveLength(1)
    expect(s.audits[0]).toMatchObject({
      tenantId: 'T1', action: 'evidence.purge', actorUid: 'system', actorRole: 'system', targetType: 'tenant', meta: { passes: 2, files: 4, retentionDays: 90 },
    })
  })

  it('a re-run is a no-op: nothing deleted, no second audit entry', async () => {
    addPass('veh_a', 100)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    await purgeOldEvidence(s.port, NOW_MS)
    const again = await purgeOldEvidence(s.port, NOW_MS)
    expect(again).toMatchObject({ passes: 0, files: 0 })
    expect(s.audits).toHaveLength(1)
  })

  it('a pass that was already stamped is skipped even without the cursor', async () => {
    const id = addPass('veh_a', 100)
    s.passes.set(id, { ...(s.passes.get(id) as PassData), evidenceDeletedAt: 5 })
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    expect(await purgeOldEvidence(s.port, NOW_MS)).toMatchObject({ passes: 0 })
    expect(s.audits).toEqual([])
  })

  it('clears a large backlog over several runs, 200 passes at a time, oldest first, without skipping any', async () => {
    for (let i = 0; i < PURGE_MAX_PASSES_PER_RUN + 30; i++) addPass(`veh_${String(i).padStart(4, '0')}`, 100 + (i % 20))
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    const first = await purgeOldEvidence(s.port, NOW_MS)
    expect(first.passes).toBe(PURGE_MAX_PASSES_PER_RUN)
    const second = await purgeOldEvidence(s.port, NOW_MS)
    expect(first.passes + second.passes).toBe(PURGE_MAX_PASSES_PER_RUN + 30)
    expect([...s.passes.values()].every((p) => p.evidenceDeletedAt !== undefined)).toBe(true)
    expect(s.files.size).toBe(0)
    expect((await purgeOldEvidence(s.port, NOW_MS)).passes).toBe(0)
  })

  it('a storage failure stops that tenant in order, leaves the pass unstamped and is retried next run', async () => {
    const bad = addPass('veh_bad', 120)
    addPass('veh_later', 110)
    s.failOn.add(bad)
    s.tenants.set('T1', { timezone: 'Asia/Colombo', retentionDays: 90 })
    expect(await purgeOldEvidence(s.port, NOW_MS)).toMatchObject({ passes: 0, failed: 1 })
    expect(s.passes.get(bad)?.evidenceDeletedAt).toBeUndefined()
    s.failOn.clear()
    expect(await purgeOldEvidence(s.port, NOW_MS)).toMatchObject({ passes: 2, failed: 0 })
  })

  it('cutoffKey uses the tenant timezone', () => {
    expect(cutoffKey('Asia/Colombo', 30, NOW_MS)).toBe(key(30))
  })
})

describe('updateTenantSettings: retentionDays', () => {
  it('is admin only, accepts 0 or 30-3650, rejects anything else, and is audited', async () => {
    const w = makeWorld()
    await updateTenantSettings(w.deps, admin(), { retentionDays: 365 })
    expect(w.tenants.get('T1')).toMatchObject({ retentionDays: 365 })
    expect(w.audits.at(-1)).toMatchObject({ action: 'tenant.settings.update', meta: { retentionDays: 365 } })
    await updateTenantSettings(w.deps, admin(), { retentionDays: 0 })
    expect(w.tenants.get('T1')).toMatchObject({ retentionDays: 0 })
    for (const bad of [1, 29, 3651, -5, 45.5, '90']) {
      await rejects(updateTenantSettings(w.deps, admin(), { retentionDays: bad }), 'invalid-argument', 'invalid-input')
    }
    await rejects(updateTenantSettings(w.deps, sup1(), { retentionDays: 90 }), 'permission-denied', 'forbidden')
  })
})
