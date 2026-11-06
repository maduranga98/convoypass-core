// In-memory fake of the gate pass port, on top of the World of test-utils. Not part of the build (see tsconfig.json).
import type { GatePassPatch, GatePassPort } from './gatePasses.js'
import { gatePassId, pairingKey, type GatePassData, type GatePassRecord, type QualificationEntry, type QualificationMeta } from './gatePassLogic.js'
import { NOW, type World } from './test-utils.js'

/** NOW (2023-11-14 22:13 UTC) is 15 November 03:43 in Asia/Colombo. */
export const TEST_MONTH = '2023-11'
export const NEXT_MONTH = '2023-12'

export interface GatePassWorld {
  passes: Map<string, GatePassData>
  qualification: Map<string, { meta: QualificationMeta; entries: Map<string, QualificationEntry> }>
  port: GatePassPort
  /** `lookupForPairing` calls, to prove the check-in reads once. */
  lookups: number
}

export const passDoc = (vehicleId: string, driverId: string, over: Partial<GatePassData> = {}): GatePassData => ({
  tenantId: 'T1',
  vehicleId,
  driverId,
  contractorId: 'C1',
  plateNo: 'WP LJ-4821',
  driverName: 'Name',
  month: TEST_MONTH,
  status: 'active',
  issuedAt: NOW * 1000 - 1000,
  issuedBy: { uid: 'admin', name: 'Name' },
  issueMode: 'manual',
  blockedReason: null,
  blockedAt: null,
  blockNote: null,
  reactivation: null,
  expiredAt: null,
  ...over,
})

export function makeGatePassWorld(w: World): GatePassWorld {
  const gp: GatePassWorld = { passes: new Map(), qualification: new Map(), port: undefined as unknown as GatePassPort, lookups: 0 }
  const rec = (id: string): GatePassRecord | null => {
    const p = gp.passes.get(id)
    return p ? { ...structuredClone(p), id } : null
  }
  const apply = (id: string, patch: GatePassPatch) => gp.passes.set(id, { ...(gp.passes.get(id) as GatePassData), ...structuredClone(patch) })

  gp.port = {
    getPass: async (id) => rec(id),
    lookupForPairing: async (tenantId, vehicleId, driverId, month) => {
      gp.lookups++
      const current = rec(gatePassId(month, vehicleId, driverId))
      if (current && current.tenantId === tenantId) return { current, hadEarlier: false }
      const hadEarlier = [...gp.passes.values()].some((p) => p.tenantId === tenantId && p.vehicleId === vehicleId && p.driverId === driverId && p.month < month)
      return { current: null, hadEarlier }
    },
    issueTx: async ({ passId, pass, audit }) => {
      const existing = rec(passId)
      if (existing) return { created: false, pass: existing }
      gp.passes.set(passId, structuredClone(pass))
      w.audits.push(audit)
      return { created: true, pass: { ...structuredClone(pass), id: passId } }
    },
    updateTx: async ({ passId, plan }) => {
      const current = rec(passId)
      const planned = plan(current)
      if (!planned || !current) return { written: false, pass: current }
      apply(passId, planned.patch)
      w.audits.push(planned.audit)
      return { written: true, pass: rec(passId) }
    },
    listActive: async (tenantId, scope) =>
      [...gp.passes]
        .filter(([, p]) => p.tenantId === tenantId && p.status === 'active' && (!scope.vehicleId || p.vehicleId === scope.vehicleId) && (!scope.driverId || p.driverId === scope.driverId))
        .map(([id]) => rec(id) as GatePassRecord),
    listTenants: async () => [...w.tenants].map(([id, data]) => ({ id, data })),
    listOver: async (tenantId, currentMonth, limit) =>
      [...gp.passes]
        .filter(([, p]) => p.tenantId === tenantId && (p.status === 'active' || p.status === 'blocked') && p.month < currentMonth)
        .sort((a, b) => a[1].month.localeCompare(b[1].month))
        .slice(0, limit)
        .map(([id]) => id),
    expireTx: async (tenantId, ids, currentMonth, nowMs) => {
      let n = 0
      for (const id of ids) {
        const p = gp.passes.get(id)
        if (!p || p.tenantId !== tenantId || (p.status !== 'active' && p.status !== 'blocked') || p.month >= currentMonth) continue
        gp.passes.set(id, { ...p, status: 'expired', expiredAt: nowMs })
        n++
      }
      if (n > 0) w.audits.push({ tenantId, action: 'gatePass.expire', actorUid: 'system', actorRole: 'system', targetType: 'gatePass', targetId: currentMonth, meta: { count: n, beforeMonth: currentMonth } })
      return n
    },
    markRollover: async (tenantId, month) => {
      w.tenants.set(tenantId, { ...(w.tenants.get(tenantId) ?? {}), gatePassRolloverMonth: month })
    },
    listCandidatePairs: async (tenantId, max) => {
      const pairs = [...w.vehicles]
        .filter(([, v]) => v.tenantId === tenantId && v.status === 'active' && w.contractors.get(v.contractorId)?.status === 'active')
        .sort((a, b) => a[0].localeCompare(b[0]))
        .flatMap(([vehicleId, v]) =>
          v.assignedDriverIds.flatMap((driverId) => {
            const u = w.users.get(driverId)
            return u && u.tenantId === tenantId && u.role === 'driver' && u.status === 'active'
              ? [{ vehicleId, driverId, contractorId: v.contractorId, contractorName: `Name ${v.contractorId}`, plateNo: v.plateNo, driverName: u.name }]
              : []
          }),
        )
      return { pairs: pairs.slice(0, max), truncated: pairs.length > max }
    },
    listPassKeys: async (tenantId, month) => new Set([...gp.passes.values()].filter((p) => p.tenantId === tenantId && p.month === month).map((p) => pairingKey(p.vehicleId, p.driverId))),
    replaceQualification: async (tenantId, month, meta, entries) => {
      gp.qualification.set(`${tenantId}_${month}`, { meta, entries: new Map(entries.map((e) => [pairingKey(e.vehicleId, e.driverId), e])) })
    },
    removeQualificationEntries: async (tenantId, month, keys) => {
      const q = gp.qualification.get(`${tenantId}_${month}`)
      for (const k of keys) q?.entries.delete(k)
    },
  }
  return gp
}

/** Seeds a pass the way `issueGatePasses` would store it. */
export function givePass(gp: GatePassWorld, vehicleId: string, driverId: string, over: Partial<GatePassData> = {}): string {
  const month = over.month ?? TEST_MONTH
  const id = gatePassId(month, vehicleId, driverId)
  gp.passes.set(id, passDoc(vehicleId, driverId, { ...over, month }))
  return id
}
