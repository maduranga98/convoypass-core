import { beforeEach, describe, expect, it } from 'vitest'
import { getDashboardTrend, runReport } from './reportsApi.js'
import { caller, makeWorld, NOW, rejects, userDoc, type World } from './test-utils.js'
import { dateKey } from './dates.js'
import { addDays, fromDateKey } from './reports/range.js'
import type { PassData, PassStatus } from './types.js'

// NOW is 2023-11-14 22:13:20 UTC = 2023-11-15 03:43:20 in Colombo.
const TODAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const DAY = fromDateKey(TODAY)
const keyOf = (offset: number) => addDays(DAY, offset).replaceAll('-', '')

const officer = () => caller('officer', 'officer')
const admin = () => caller('admin', 'admin')

let w: World
let n = 0
beforeEach(() => {
  w = makeWorld()
  n = 0
  w.users.set('sec', userDoc({ role: 'security', contractorId: null, email: 'sec@x.com', phone: null }))
  w.vehicles.set('veh_aaaaaaaaaa', {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP A 1', plateKey: 'WPA1', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active',
  })
  w.vehicles.set('veh_foreignxxx', {
    tenantId: 'T2', contractorId: 'CX', plateNo: 'WP F 1', plateKey: 'WPF1', type: 'Tipper', assignedDriverIds: [], status: 'active',
  })
})

const seed = (status: PassStatus, dateKeyValue = TODAY, over: Partial<PassData> = {}): void => {
  w.passes.set(`veh_aaaaaaaaaa_${dateKeyValue}_${n++}`, {
    tenantId: 'T1', contractorId: 'C1', vehicleId: 'veh_aaaaaaaaaa', plateNo: 'WP A 1', vehicleType: 'Tipper', dateKey: dateKeyValue,
    driverId: 'drv1', driverName: 'Dan', status, attempt: 1, submittedAt: NOW * 1000,
    checklist: [], evidence: { gps: { path: 'secret/gps.jpg', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'secret/d.jpg', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    ...over,
  })
}

const input = (over: Record<string, unknown> = {}) => ({ type: 'contractor_activity', from: DAY, to: DAY, ...over })

describe('access', () => {
  it('admin and officer may run reports and the trend', async () => {
    for (const c of [admin(), officer()]) {
      await expect(runReport(w.deps, c, input())).resolves.toMatchObject({ type: 'contractor_activity' })
      await expect(getDashboardTrend(w.deps, c, { days: 7 })).resolves.toMatchObject({ days: expect.any(Array) })
    }
  })
  it('supervisor, driver and security are denied', async () => {
    for (const c of [caller('sup1', 'supervisor', 'C1'), caller('drv1', 'driver', 'C1'), caller('sec', 'security')]) {
      await rejects(runReport(w.deps, c, input()), 'permission-denied', 'forbidden')
      await rejects(getDashboardTrend(w.deps, c, { days: 7 }), 'permission-denied', 'forbidden')
    }
  })
  it('a disabled admin is refused', async () => {
    w.users.set('admin', userDoc({ role: 'admin', contractorId: null, status: 'disabled' }))
    await rejects(runReport(w.deps, admin(), input()), 'permission-denied', 'caller-not-active')
  })
  it('never returns another tenant\'s passes', async () => {
    seed('submitted')
    w.passes.set('foreign_pass', { ...(w.passes.values().next().value as PassData), tenantId: 'T2', contractorId: 'CX' })
    const r = await runReport(w.deps, admin(), input())
    expect(r.rows.map((x) => x.contractor)).toEqual(['Name C1', 'Total'])
    expect(r.rows[0]?.submissions).toBe(1)
  })
})

describe('validation', () => {
  it('rejects ids that belong to another tenant', async () => {
    await rejects(runReport(w.deps, admin(), input({ contractorId: 'CX' })), 'invalid-argument', 'filter-invalid')
    await rejects(runReport(w.deps, admin(), input({ type: 'vehicle_history', vehicleId: 'veh_foreignxxx' })), 'invalid-argument', 'filter-invalid')
    await rejects(runReport(w.deps, admin(), input({ type: 'driver_history', driverId: 'foreign' })), 'invalid-argument', 'filter-invalid')
    await rejects(runReport(w.deps, admin(), input({ contractorId: 'nope' })), 'invalid-argument', 'filter-invalid')
  })
  it('history reports need their id', async () => {
    await rejects(runReport(w.deps, admin(), input({ type: 'vehicle_history' })), 'invalid-argument', 'id-required')
    await rejects(runReport(w.deps, admin(), input({ type: 'driver_history' })), 'invalid-argument', 'id-required')
    await expect(runReport(w.deps, admin(), input({ type: 'vehicle_history', vehicleId: 'veh_aaaaaaaaaa' }))).resolves.toBeDefined()
    await expect(runReport(w.deps, admin(), input({ type: 'driver_history', driverId: 'drv1' }))).resolves.toBeDefined()
  })
  it('range: at most 92 days, ordered, real dates', async () => {
    await expect(runReport(w.deps, admin(), input({ from: addDays(DAY, -91) }))).resolves.toBeDefined()
    await rejects(runReport(w.deps, admin(), input({ from: addDays(DAY, -92) })), 'invalid-argument', 'range-too-long')
    await rejects(runReport(w.deps, admin(), input({ from: addDays(DAY, 1) })), 'invalid-argument', 'range-invalid')
    await rejects(runReport(w.deps, admin(), input({ from: '2026-02-30' })), 'invalid-argument', 'range-invalid')
    await rejects(runReport(w.deps, admin(), input({ from: 'yesterday' })), 'invalid-argument', 'range-invalid')
    await rejects(runReport(w.deps, admin(), input({ type: 'nope' })), 'invalid-argument', 'invalid-input')
  })
  it('trend only accepts 7, 14 or 30 days', async () => {
    await rejects(getDashboardTrend(w.deps, admin(), { days: 10 }), 'invalid-argument', 'invalid-input')
  })
})

describe('scan cap', () => {
  it('refuses with resource-exhausted instead of returning partial data', async () => {
    for (let i = 0; i < 4; i++) seed('submitted')
    await rejects(runReport(w.deps, admin(), input(), 3), 'resource-exhausted', 'range-too-large')
    await rejects(runReport(w.deps, admin(), input({ type: 'turnaround' }), 3), 'resource-exhausted', 'range-too-large')
    await expect(runReport(w.deps, admin(), input(), 4)).resolves.toBeDefined()
  })
  it('counts check-ins and denials together for the gate log', async () => {
    seed('checked_in', TODAY, { checkIn: { uid: 's', name: 'G', at: NOW * 1000, gateId: 'main', gateName: 'Main Gate', requestId: 'r' } })
    w.gateEvents.set('den_1', {
      tenantId: 'T1', type: 'denied', vehicleId: 'veh_aaaaaaaaaa', plateNo: 'WP A 1', contractorId: 'C1', passId: null, passStatus: null,
      driverName: null, dateKey: TODAY, reasonCode: 'other', gateId: 'main', gateName: 'Main Gate', byUid: 's', byName: 'G', at: NOW * 1000, requestId: 'q',
    })
    await rejects(runReport(w.deps, admin(), input({ type: 'gate_log' }), 1), 'resource-exhausted', 'range-too-large')
    const r = await runReport(w.deps, admin(), input({ type: 'gate_log' }), 2)
    expect(r.rows).toHaveLength(2)
  })
})

describe('report contents', () => {
  it('filters by contractor and keeps photo paths out', async () => {
    seed('checked_in')
    seed('submitted', TODAY, { contractorId: 'C2' })
    const r = await runReport(w.deps, admin(), input({ type: 'vehicle_history', vehicleId: 'veh_aaaaaaaaaa', contractorId: 'C1' }))
    expect(r.rows).toHaveLength(1)
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(r.timezone).toBe('Asia/Colombo')
    expect(r.generatedAt).toBe(NOW * 1000)
  })
  it('gate log: a driver filter shows that driver\'s check-ins only', async () => {
    seed('checked_in', TODAY, { checkIn: { uid: 's', name: 'G', at: NOW * 1000, gateId: 'main', gateName: 'Main Gate', requestId: 'r' } })
    w.gateEvents.set('den_1', {
      tenantId: 'T1', type: 'denied', vehicleId: 'veh_aaaaaaaaaa', plateNo: 'WP A 1', contractorId: 'C1', passId: null, passStatus: null,
      driverName: null, dateKey: TODAY, reasonCode: 'other', gateId: 'main', gateName: 'Main Gate', byUid: 's', byName: 'G', at: NOW * 1000, requestId: 'q',
    })
    const r = await runReport(w.deps, admin(), input({ type: 'gate_log', driverId: 'drv1' }))
    expect(r.rows.map((x) => x.type)).toEqual(['Check-in'])
  })
})

describe('getDashboardTrend', () => {
  it('returns one entry per day, oldest first, filling missing days with zeros', async () => {
    seed('submitted')
    seed('checked_in')
    seed('rejected')
    seed('officer_approved', keyOf(-2))
    const r = await getDashboardTrend(w.deps, officer(), { days: 7 })
    expect(r.days).toHaveLength(7)
    expect(r.days[0]?.dateKey).toBe(keyOf(-6))
    expect(r.days.at(-1)?.dateKey).toBe(TODAY)
    expect(r.days.at(-1)).toEqual({ dateKey: TODAY, submitted: 3, approved: 1, checkedIn: 1, rejected: 1 })
    expect(r.days.find((d) => d.dateKey === keyOf(-2))).toMatchObject({ submitted: 1, approved: 1, checkedIn: 0, rejected: 0 })
    expect(r.days.find((d) => d.dateKey === keyOf(-5))).toEqual({ dateKey: keyOf(-5), submitted: 0, approved: 0, checkedIn: 0, rejected: 0 })
    expect((await getDashboardTrend(w.deps, officer(), { days: 30 })).days).toHaveLength(30)
  })
})

describe('gate_passes report', () => {
  it('joins a day’s passes with their in/out visits and the company gate time', async () => {
    seed('checked_in', TODAY, { checkIn: { uid: 'sec', name: 'Sam', at: NOW * 1000, gateId: 'main', gateName: 'Main Gate', requestId: 'r' } })
    w.reportVisits.push(
      { id: 'a', vehicleId: 'veh_aaaaaaaaaa', dateKey: TODAY, checkInAt: NOW * 1000, checkOutAt: NOW * 1000 + 3_600_000 },
      { id: 'b', vehicleId: 'veh_aaaaaaaaaa', dateKey: TODAY, checkInAt: NOW * 1000 + 7_200_000, checkOutAt: null },
      { id: 'other', vehicleId: 'veh_zzzzzzzzzz', dateKey: TODAY, checkInAt: NOW * 1000, checkOutAt: null },
    )
    const r = await runReport(w.deps, officer(), input({ type: 'gate_passes' }))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ plate: 'WP A 1', entries: 2, gate: 'Inside', endsAt: NOW * 1000 + 16 * 3_600_000 })
    expect(JSON.stringify(r)).not.toContain('secret/')
  })
})
