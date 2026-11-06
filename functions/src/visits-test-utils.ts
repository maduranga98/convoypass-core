// In-memory fakes of the visit ports, on top of the World of test-utils. Not part of the build (see tsconfig.json).
import { dateKey } from './dates.js'
import { passIdFor } from './passes.js'
import { NOW, type World } from './test-utils.js'
import type { DriverData, PassData, UserData, VisitData } from './types.js'
import type { VisitPort, VisitRecord } from './visits.js'
import type { DwellPort } from './dwell.js'
import { makeGatePassWorld, type GatePassWorld } from './gatepass-test-utils.js'
import { dwellLimitHoursOf } from './visitLogic.js'

export interface VisitWorld {
  visits: Map<string, VisitData>
  penaltiesIssued: { tenantId: string; contractorId: string; issuedAt: number }[]
  port: VisitPort
  dwell: DwellPort
  /** Module 6: the monthly gate passes the check-in consults. A test seeds them with `givePass(vw.gatePasses, …)`. */
  gatePasses: GatePassWorld
}

/**
 * Seeds the day's pass of a vehicle as checked in (the first entry of the day), so the later entries of `checkInVisit` have
 * a gate time to run in. `checkedInAt` defaults to the test clock; `day` to the test clock's day.
 */
export function giveCheckedInPass(w: World, vehicleId: string, driverId: string, over: { checkedInAt?: number; day?: string } = {}): string {
  const checkedInAt = over.checkedInAt ?? NOW * 1000
  const day = over.day ?? dateKey('Asia/Colombo', new Date(checkedInAt))
  const id = passIdFor(vehicleId, day)
  const driver = w.users.get(driverId)
  w.passes.set(id, {
    tenantId: 'T1',
    contractorId: 'C1',
    vehicleId,
    plateNo: w.vehicles.get(vehicleId)?.plateNo ?? '',
    vehicleType: 'Tipper',
    dateKey: day,
    driverId,
    driverName: driver?.name ?? 'Driver',
    status: 'checked_in',
    attempt: 1,
    submittedAt: checkedInAt - 3_600_000,
    checkIn: { uid: 'sec', name: 'Sam', at: checkedInAt, gateId: 'main', gateName: 'Main Gate', requestId: '0f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f' },
  } as unknown as PassData)
  return id
}

export function makeVisitWorld(w: World): VisitWorld {
  const vw: VisitWorld = {
    visits: new Map(),
    penaltiesIssued: [],
    port: undefined as unknown as VisitPort,
    dwell: undefined as unknown as DwellPort,
    gatePasses: makeGatePassWorld(w),
  }
  const rec = (id: string): VisitRecord | null => {
    const v = vw.visits.get(id)
    return v ? { ...structuredClone(v), id } : null
  }
  const inScope = (v: VisitData, s: { tenantId: string; contractorId: string | null }) =>
    v.tenantId === s.tenantId && (s.contractorId === null || v.contractorId === s.contractorId)

  vw.port = {
    lookupForPairing: (...a) => vw.gatePasses.port.lookupForPairing(...a),
    getVisit: async (id) => rec(id),
    // The fakes read and write synchronously from the plan to the write, which models the transaction.
    checkInTx: async ({ visitId, tenantId, vehicleId, driverId, plan }) => {
      const active = [...vw.visits].find(([, v]) => v.tenantId === tenantId && v.vehicleId === vehicleId && v.status === 'checked_in')
      const planned = plan({
        existing: rec(visitId),
        vehicleActive: active ? rec(active[0]) : null,
        driver: structuredClone(w.drivers.get(driverId) ?? null),
        driverUser: structuredClone(w.users.get(driverId) ?? null),
      })
      if (planned.kind === 'replay') return planned
      vw.visits.set(visitId, structuredClone(planned.visit))
      const user = w.users.get(driverId) as UserData
      const base: DriverData = w.drivers.get(driverId) ?? { tenantId: user.tenantId, contractorId: user.contractorId as string, name: user.name, phone: user.phone, status: user.status }
      w.drivers.set(driverId, { ...base, driverOnDutyLock: true, activeVisitId: visitId })
      w.audits.push(planned.audit)
      return planned
    },
    checkOutTx: async ({ visitId, plan }) => {
      const visit = rec(visitId)
      const planned = plan(visit)
      if (planned.kind === 'replay' || !visit) return planned
      vw.visits.set(visitId, { ...(vw.visits.get(visitId) as VisitData), status: 'checked_out', checkOut: structuredClone(planned.checkOut), driverOnDutyLock: false })
      const d = w.drivers.get(visit.driverId)
      if (d && d.activeVisitId === visitId) w.drivers.set(visit.driverId, { ...d, driverOnDutyLock: false, activeVisitId: null })
      w.audits.push(planned.audit)
      return planned
    },
    unloadTx: async ({ visitId, plan }) => {
      const planned = plan(rec(visitId))
      vw.visits.set(visitId, { ...(vw.visits.get(visitId) as VisitData), unloadingCheck: structuredClone(planned.unloadingCheck) })
      w.audits.push(planned.audit)
      return planned
    },
    countStage: async (scope, stage, dateKey) => [...vw.visits.values()].filter((v) => inScope(v, scope) && v[stage]?.dateKey === dateKey).length,
    countActive: async (scope, { awaitingUnload }) =>
      [...vw.visits.values()].filter((v) => inScope(v, scope) && v.status === 'checked_in' && (!awaitingUnload || v.unloadingCheck === null)).length,
    listDwell: async (scope, limit) =>
      [...vw.visits]
        .filter(([, v]) => inScope(v, scope) && v.status === 'checked_in' && v.dwellWarning)
        .sort((a, b) => a[1].checkIn.timestamp - b[1].checkIn.timestamp)
        .slice(0, limit)
        .map(([id]) => rec(id) as VisitRecord),
    countPenaltiesIssued: async (scope, from, to) =>
      vw.penaltiesIssued.filter((p) => p.tenantId === scope.tenantId && (scope.contractorId === null || p.contractorId === scope.contractorId) && p.issuedAt >= from && p.issuedAt <= to).length,
  }
  vw.dwell = {
    listTenants: async () => [...w.tenants].map(([id, data]) => ({ id, data })),
    listOverdue: async (tenantId, cutoff, limit) =>
      [...vw.visits]
        .filter(([, v]) => v.tenantId === tenantId && v.status === 'checked_in' && !v.dwellWarning && v.checkIn.timestamp <= cutoff)
        .sort((a, b) => a[1].checkIn.timestamp - b[1].checkIn.timestamp)
        .slice(0, limit)
        .map(([id]) => id),
    flag: async (tenantId, ids, cutoff, nowMs) => {
      let n = 0
      const limitHours = dwellLimitHoursOf(w.tenants.get(tenantId))
      for (const id of ids) {
        const v = vw.visits.get(id)
        if (!v || v.status !== 'checked_in' || v.dwellWarning || v.checkIn.timestamp > cutoff) continue
        vw.visits.set(id, { ...v, dwellWarning: true, dwellWarningAt: nowMs })
        w.audits.push({ tenantId, action: 'visit.dwellWarning', actorUid: 'system', actorRole: 'system', targetType: 'visit', targetId: id, meta: { limitHours } })
        n++
      }
      return n
    },
  }
  return vw
}
