// In-memory fakes of the visitor port, on top of the World of test-utils. Not part of the build (see tsconfig.json).
import { NOW, userDoc, type World } from './test-utils.js'
import { isOverstay } from './visitorLogic.js'
import type { AuditEntry, VisitorData, VisitorPassData } from './types.js'
import type { VisitorPort, VisitorPassRecord } from './visitors.js'

export interface VisitorWorld {
  visitors: Map<string, VisitorData>
  passes: Map<string, VisitorPassData>
  /** `${tenantId}_${yyyyMM}` -> count */
  usage: Map<string, number>
  codes: Map<string, string>
  port: VisitorPort
  /** Codes handed out next (to force a collision), oldest first; then the default generator. */
  forcedCodes: string[]
}

export const makeVisitorWorld = (w: World): VisitorWorld => {
  const vw: VisitorWorld = { visitors: new Map(), passes: new Map(), usage: new Map(), codes: new Map(), port: undefined as unknown as VisitorPort, forcedCodes: [] }
  const rec = (id: string): VisitorPassRecord | null => {
    const p = vw.passes.get(id)
    return p ? { ...structuredClone(p), id } : null
  }
  w.users.set('admin_t2', userDoc({ tenantId: 'T2', role: 'admin', contractorId: null, email: 'a@t2.com', phone: null }))

  vw.port = {
    // The fakes read and write synchronously from the plan to the write, which models the transaction.
    issueTx: async ({ passId, visitorId, tenantId, month, code, plan }) => {
      const taken = vw.forcedCodes.length > 0 && vw.codes.has(`${tenantId}_${code}`)
      const planned = plan({
        existingPass: rec(passId),
        visitor: vw.visitors.has(visitorId) ? { ...structuredClone(vw.visitors.get(visitorId) as VisitorData), id: visitorId } : null,
        used: vw.usage.get(`${tenantId}_${month}`) ?? 0,
        codeTaken: taken || vw.codes.has(`${tenantId}_${code}`),
      })
      if (planned.kind !== 'write') return planned
      vw.passes.set(passId, structuredClone(planned.pass))
      vw.codes.set(`${tenantId}_${code}`, passId)
      vw.visitors.set(visitorId, structuredClone(planned.visitor))
      vw.usage.set(`${tenantId}_${month}`, planned.usedAfter)
      w.audits.push(...planned.audits)
      return planned
    },
    getPass: async (id) => rec(id),
    findPassByCode: async (tenantId, code) => {
      const hit = [...vw.passes].find(([, p]) => p.tenantId === tenantId && p.passCode === code)
      return hit ? rec(hit[0]) : null
    },
    getVisitor: async (id) => (vw.visitors.has(id) ? { ...structuredClone(vw.visitors.get(id) as VisitorData), id } : null),
    updatePassTx: async ({ passId, plan }) => {
      const current = rec(passId)
      const planned = plan(current)
      if (!planned || !current) return { written: false, pass: current }
      vw.passes.set(passId, { ...(vw.passes.get(passId) as VisitorPassData), ...planned.patch })
      w.audits.push(planned.audit)
      return { written: true, pass: rec(passId) }
    },
    updateVisitorTx: async ({ visitorId, tenantId, patch, audit }) => {
      const v = vw.visitors.get(visitorId)
      if (!v || v.tenantId !== tenantId) return
      vw.visitors.set(visitorId, { ...v, ...patch })
      for (const [id, p] of vw.passes) {
        if (p.visitorId !== visitorId || (p.status !== 'active' && p.status !== 'checked_in')) continue
        vw.passes.set(id, {
          ...p,
          ...(patch.fullName !== undefined ? { visitorName: patch.fullName } : {}),
          ...(patch.organization !== undefined ? { visitorOrganization: patch.organization } : {}),
          ...(patch.photoPath !== undefined ? { photoPath: patch.photoPath } : {}),
        })
      }
      w.audits.push(audit)
    },
    updateSettingsTx: async ({ tenantId, settings, audit }) => {
      w.tenants.set(tenantId, { ...(w.tenants.get(tenantId) ?? {}), visitorSettings: settings })
      w.audits.push(audit)
    },
    usedThisMonth: async (tenantId, month) => vw.usage.get(`${tenantId}_${month}`) ?? 0,
    listTenants: async () => [...w.tenants].map(([id, data]) => ({ id, data })),
    listExpired: async (tenantId, nowMs, limit) =>
      [...vw.passes].filter(([, p]) => p.tenantId === tenantId && p.status === 'active' && p.validUntil < nowMs).slice(0, limit).map(([id]) => id),
    expireTx: async (tenantId, ids, nowMs) => {
      let n = 0
      for (const id of ids) {
        const p = vw.passes.get(id)
        if (!p || p.status !== 'active' || p.validUntil >= nowMs) continue
        vw.passes.set(id, { ...p, status: 'expired', expiredAt: nowMs })
        n++
      }
      if (n > 0) w.audits.push({ tenantId, action: 'visitorPass.expire', actorUid: 'system', actorRole: 'system', targetType: 'visitorPass', targetId: `batch_${nowMs}`, meta: { count: n } } satisfies AuditEntry)
      return n
    },
    listUnflaggedInside: async (tenantId, limit) =>
      [...vw.passes].filter(([, p]) => p.tenantId === tenantId && p.status === 'checked_in' && !p.dwellWarning).slice(0, limit).map(([id]) => rec(id) as VisitorPassRecord),
    flagTx: async (tenantId, ids, nowMs) => {
      let n = 0
      for (const id of ids) {
        const p = vw.passes.get(id)
        if (!p || p.dwellWarning || !isOverstay(p, nowMs)) continue
        vw.passes.set(id, { ...p, dwellWarning: true, dwellWarningAt: nowMs })
        w.audits.push({ tenantId, action: 'visitorPass.dwellWarning', actorUid: 'system', actorRole: 'system', targetType: 'visitorPass', targetId: id, meta: { limitMinutes: p.maxDwellMinutes } })
        n++
      }
      return n
    },
  }
  return vw
}

export const NOW_MS = NOW * 1000
