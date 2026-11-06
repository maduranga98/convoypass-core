import { beforeEach, describe, expect, it } from 'vitest'
import { flagDwellVisits } from './dwell.js'
import { createUser, reissuePin, resetCredential } from './core.js'
import { recordInspection } from './inspections.js'
import { pinKey } from './pin.js'
import { dayBoundsMs, checkInVisit, checkOutVisit, getDailySummary, logUnloadingCheck } from './visits.js'
import { NOW, TEST_PEPPER, admin, caller, drv1, makeWorld, rejects, sup1, sup2, type World } from './test-utils.js'
import { givePass } from './gatepass-test-utils.js'
import { giveCheckedInPass, makeVisitWorld, type VisitWorld } from './visits-test-utils.js'

const NOW_MS = NOW * 1000
const VID = 'veh_aaaaaaaaaa'
const V2 = 'veh_bbbbbbbbbb'
const VIS = 'vis_aaaaaaaaaa'
const VIS2 = 'vis_bbbbbbbbbb'
const REQ = '3f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'
const REQ2 = '4f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'

const sec = () => caller('sec', 'security')
const yard = () => caller('yard1', 'yard')

let w: World
let vw: VisitWorld
beforeEach(async () => {
  w = makeWorld()
  vw = makeVisitWorld(w)
  w.vehicles.set(VID, { tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1', 'drv1b'], status: 'active' })
  w.vehicles.set(V2, { tenantId: 'T1', contractorId: 'C1', plateNo: 'CAB-1', plateKey: 'CAB1', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
  w.users.set('drv1b', { ...(w.users.get('drv1') as never), name: 'Second Driver' })
  // The first entry of the day is the pass check-in: both vehicles have a checked-in pass, so later entries (checkInVisit) can run.
  giveCheckedInPass(w, VID, 'drv1')
  giveCheckedInPass(w, V2, 'drv1')
  // Module 6: the monthly gate pass is the last gate, so every pairing these tests check in holds an active pass.
  for (const [v, d] of [[VID, 'drv1'], [VID, 'drv1b'], [V2, 'drv1']] as const) givePass(vw.gatePasses, v, d)
  // Module 4: only a vehicle with a standing approved inspection is eligible, so clear the two test vehicles first.
  for (const [i, vehicleId] of [VID, V2].entries()) {
    await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: `insp_aaaaaaaaa${i}`, vehicleId, result: 'approved', notes: '' })
  }
})

const checkIn = (c = sec(), over: Record<string, unknown> = {}) =>
  checkInVisit(w.deps, vw.port, c, { visitId: VIS, vehicleId: VID, requestId: REQ, ...over })

describe('checkInVisit', () => {
  it('creates the visit, locks the driver and audits', async () => {
    const res = await checkIn(sec(), { gateId: 'main' })
    expect(res).toMatchObject({ outcome: 'checked_in', visitId: VIS, plateNo: 'WP LJ-4821', at: NOW_MS })
    expect(vw.visits.get(VIS)).toMatchObject({
      tenantId: 'T1', vehicleId: VID, driverId: 'drv1', contractorId: 'C1', status: 'checked_in', driverOnDutyLock: true, dwellWarning: false,
      unloadingCheck: null, checkOut: null,
      checkIn: { timestamp: NOW_MS, securityUserId: 'sec', gateId: 'main', gateLocation: 'Main Gate', requestId: REQ },
    })
    expect(w.drivers.get('drv1')).toMatchObject({ driverOnDutyLock: true, activeVisitId: VIS })
    expect(w.audits.at(-1)).toMatchObject({ action: 'visit.checkIn', targetType: 'visit', targetId: VIS })
  })

  it('is idempotent: a retry with the same id returns the stored visit and creates nothing twice', async () => {
    const first = await checkIn()
    const again = await checkIn()
    expect(again).toEqual(first)
    expect(vw.visits.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'visit.checkIn')).toHaveLength(1)
  })

  it('refuses a clashing visit id from another guard', async () => {
    await checkIn()
    w.users.set('sec2', { ...(w.users.get('sec') as never) })
    await rejects(checkIn(caller('sec2', 'security')), 'already-exists', 'request-conflict')
  })

  it('rejects a second concurrent visit of an on-duty driver on the server', async () => {
    await checkIn()
    await rejects(checkIn(sec(), { visitId: VIS2, vehicleId: V2, requestId: REQ2 }), 'failed-precondition', 'driver-on-duty')
    expect(vw.visits.size).toBe(1)
  })

  it('rejects a vehicle that is already on site', async () => {
    await checkIn()
    await rejects(checkIn(sec(), { visitId: VIS2, requestId: REQ2 }), 'failed-precondition', 'vehicle-on-site')
  })

  it('frees the driver on check-out so the next visit works', async () => {
    await checkIn()
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    expect(w.drivers.get('drv1')).toMatchObject({ driverOnDutyLock: false, activeVisitId: null })
    const next = await checkIn(sec(), { visitId: VIS2, vehicleId: V2, requestId: REQ2 })
    expect(next.outcome).toBe('checked_in')
  })

  it('creates the drivers doc for a driver that predates Module 2', async () => {
    w.drivers.delete('drv1')
    await checkIn()
    expect(w.drivers.get('drv1')).toMatchObject({ tenantId: 'T1', contractorId: 'C1', driverOnDutyLock: true })
  })

  it('takes the driver from the day’s pass, with no PIN', async () => {
    giveCheckedInPass(w, VID, 'drv1b')
    const res = await checkIn()
    expect(res.outcome).toBe('checked_in')
    expect(vw.visits.get(VIS)).toMatchObject({ driverId: 'drv1b', passId: expect.stringContaining(VID) })
  })

  it('a vehicle can go in and out several times a day', async () => {
    await checkIn()
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    const again = await checkIn(sec(), { visitId: VIS2, requestId: '5f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f' })
    expect(again).toMatchObject({ outcome: 'checked_in', visitId: VIS2 })
    expect([...vw.visits.values()].map((v) => v.status).sort()).toEqual(['checked_in', 'checked_out'])
  })

  it('refuses an entry when the vehicle was not checked in today', async () => {
    w.passes.delete(`${VID}_20231115`)
    await rejects(checkIn(), 'failed-precondition', 'pass-not-checked-in')
    expect(vw.visits.size).toBe(0)
  })

  it('refuses an entry once the gate time (16 h from the first check-in) is over, but allows the check-out', async () => {
    await checkIn()
    giveCheckedInPass(w, VID, 'drv1', { checkedInAt: NOW_MS - 16 * 3_600_000 - 1, day: '20231115' })
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    await rejects(checkIn(sec(), { visitId: VIS2, requestId: REQ }), 'failed-precondition', 'gate-time-over')
  })

  it('still accepts an entry just inside the gate time, also across midnight', async () => {
    // The test clock is 03:43 on 2023-11-15 in Colombo; the first entry was 15 h earlier, on the 14th.
    w.passes.delete(`${V2}_20231115`)
    giveCheckedInPass(w, V2, 'drv1', { checkedInAt: NOW_MS - 15 * 3_600_000, day: '20231114' })
    expect((await checkIn(sec(), { vehicleId: V2 })).outcome).toBe('checked_in')
  })

  it('uses the company’s gate time setting', async () => {
    w.tenants.set('T1', { ...(w.tenants.get('T1') as never), dwellLimitHours: 2 })
    giveCheckedInPass(w, VID, 'drv1', { checkedInAt: NOW_MS - 3 * 3_600_000, day: '20231115' })
    await rejects(checkIn(), 'failed-precondition', 'gate-time-over')
  })

  it('does not ask for another safety inspection on a later trip of the day', async () => {
    const { clearance: _c, ...base } = w.vehicles.get(VID) as never as Record<string, unknown> & { clearance?: unknown }
    void _c
    w.vehicles.set('veh_cccccccccc', { ...(base as never), plateNo: 'NEW-1', plateKey: 'NEW1' }) // never inspected
    giveCheckedInPass(w, 'veh_cccccccccc', 'drv1')
    givePass(vw.gatePasses, 'veh_cccccccccc', 'drv1')
    expect(await checkIn(sec(), { vehicleId: 'veh_cccccccccc' })).toMatchObject({ outcome: 'checked_in', plateNo: 'NEW-1' })
  })

  it('returns the eligibility output untouched when blocked, creates nothing and locks nobody', async () => {
    w.vehicles.set(VID, { ...(w.vehicles.get(VID) as never), insuranceExpiry: '2000-01-01' })
    const res = await checkIn()
    expect(res).toMatchObject({ outcome: 'blocked', eligibility: { eligible: false, status: 'expired' } })
    expect(vw.visits.size).toBe(0)
    expect(w.drivers.get('drv1')?.driverOnDutyLock).toBeUndefined()
    expect(w.audits.at(-1)).toMatchObject({ action: 'visit.checkInBlocked' })
  })

  it('shows an expired document as the reason, straight from the shared check', async () => {
    w.vehicles.set(VID, { ...(w.vehicles.get(VID) as never), insuranceExpiry: '2000-01-01' })
    const res = await checkIn()
    expect(res).toMatchObject({ outcome: 'blocked', eligibility: { status: 'expired', vehicle: { documentStatus: 'expired' } } })
    expect(vw.visits.size).toBe(0)
  })

  it('refuses suspended vehicle and contractor, other roles, and unknown vehicles', async () => {
    w.vehicles.set(VID, { ...(w.vehicles.get(VID) as never), status: 'suspended' })
    await rejects(checkIn(), 'failed-precondition', 'vehicle-suspended')
    w.vehicles.set(VID, { ...(w.vehicles.get(VID) as never), status: 'active', contractorId: 'CS' })
    await rejects(checkIn(), 'failed-precondition', 'contractor-suspended')
    for (const c of [admin(), sup1(), yard(), drv1(), caller('officer', 'officer'), caller('safe1', 'safety')]) {
      await rejects(checkIn(c), 'permission-denied', 'forbidden')
    }
    await rejects(checkIn(sec(), { vehicleId: 'veh_zzzzzzzzzz' }), 'not-found', 'vehicle-not-found')
    w.vehicles.set('veh_foreignaaa', { ...(w.vehicles.get(V2) as never), tenantId: 'T2' })
    await rejects(checkIn(sec(), { vehicleId: 'veh_foreignaaa' }), 'not-found', 'vehicle-not-found')
  })

  it('rejects bad input and a gate that does not exist', async () => {
    await rejects(checkIn(sec(), { visitId: 'nope' }), 'invalid-argument', 'invalid-input')
    await rejects(checkIn(sec(), { requestId: 'x' }), 'invalid-argument', 'invalid-input')
    await rejects(checkIn(sec(), { gateId: 'nowhere' }), 'invalid-argument', 'gate-invalid')
  })
})

describe('checkOutVisit', () => {
  beforeEach(async () => {
    await checkIn()
  })
  const out = (c = sec(), over: Record<string, unknown> = {}) => checkOutVisit(w.deps, vw.port, c, { visitId: VIS, requestId: REQ2, ...over })

  it('sets checkOut, flips the status, unlocks the driver and flags a missing unloading check', async () => {
    const res = await out()
    expect(res).toEqual({ visitId: VIS, at: NOW_MS, unloadingMissing: true })
    expect(vw.visits.get(VIS)).toMatchObject({ status: 'checked_out', driverOnDutyLock: false, checkOut: { securityUserId: 'sec', requestId: REQ2 } })
    expect(w.audits.at(-1)?.action).toBe('visit.checkOut')
  })

  it('is idempotent for the same request and refuses a different one with who was first', async () => {
    await out()
    expect(await out()).toEqual({ visitId: VIS, at: NOW_MS, unloadingMissing: true }) // the same answer as the first call
    await rejects(out(sec(), { requestId: '5f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f' }), 'already-exists', 'visit-checked-out')
    expect(w.audits.filter((a) => a.action === 'visit.checkOut')).toHaveLength(1)
  })

  it('needs no eligibility: a vehicle that became blocked can still leave', async () => {
    w.vehicles.set(VID, { ...(w.vehicles.get(VID) as never), status: 'suspended' })
    w.drivers.set('drv1', { ...(w.drivers.get('drv1') as never), status: 'disabled' })
    expect((await out()).visitId).toBe(VIS)
  })

  it('is for security only, and another company cannot see the visit', async () => {
    for (const c of [admin(), yard(), sup1(), drv1(), caller('officer', 'officer')]) await rejects(out(c), 'permission-denied', 'forbidden')
    w.users.set('secX', { ...(w.users.get('sec') as never), tenantId: 'T2' })
    await rejects(out({ ...sec(), uid: 'secX', tenantId: 'T2' }), 'not-found', 'visit-not-found')
    await rejects(out(sec(), { visitId: 'vis_zzzzzzzzzz' }), 'not-found', 'visit-not-found')
  })

  it('leaves a lock held by a different visit alone', async () => {
    w.drivers.set('drv1', { ...(w.drivers.get('drv1') as never), activeVisitId: 'vis_other00000' })
    await out()
    expect(w.drivers.get('drv1')).toMatchObject({ driverOnDutyLock: true, activeVisitId: 'vis_other00000' })
  })
})

describe('logUnloadingCheck', () => {
  beforeEach(async () => {
    await checkIn()
  })
  const log = (c = yard(), over: Record<string, unknown> = {}) => logUnloadingCheck(w.deps, vw.port, c, { visitId: VIS, unloaded: true, unloadLocation: 'Bay 3', ...over })

  it('stores who, when, the result and the place, and changes nothing else', async () => {
    const before = structuredClone(vw.visits.get(VIS))
    await log()
    expect(vw.visits.get(VIS)).toMatchObject({
      unloadingCheck: { performed: true, timestamp: NOW_MS, officerUserId: 'yard1', unloaded: true, unloadLocation: 'Bay 3' },
      status: 'checked_in', checkIn: before?.checkIn, checkOut: null,
    })
    expect(w.audits.at(-1)?.action).toBe('visit.unloadingCheck')
  })

  it('"not unloaded" never keeps a location; "unloaded" needs one', async () => {
    await log(yard(), { unloaded: false, unloadLocation: 'Bay 3' })
    expect(vw.visits.get(VIS)?.unloadingCheck).toMatchObject({ unloaded: false, unloadLocation: null })
    await rejects(log(yard(), { unloadLocation: undefined }), 'invalid-argument', 'unload-location-required')
    await rejects(log(yard(), { unloadLocation: ' ' }), 'invalid-argument', 'invalid-input')
  })

  it('can be corrected while the vehicle is on site (audited as an update)', async () => {
    await log()
    await log(yard(), { unloadLocation: 'Bay 5' })
    expect(vw.visits.get(VIS)?.unloadingCheck?.unloadLocation).toBe('Bay 5')
    expect(w.audits.at(-1)?.action).toBe('visit.unloadingUpdate')
  })

  it('refuses a vehicle that has left, other roles, and other companies', async () => {
    for (const c of [sec(), admin(), sup1(), drv1(), caller('safe1', 'safety')]) await rejects(log(c), 'permission-denied', 'forbidden')
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    await rejects(log(), 'failed-precondition', 'visit-not-active')
    w.users.set('yardX', { ...(w.users.get('yard1') as never), tenantId: 'T2' })
    await rejects(log({ ...yard(), uid: 'yardX', tenantId: 'T2' }), 'not-found', 'visit-not-found')
  })
})

describe('getDailySummary', () => {
  beforeEach(async () => {
    await checkIn()
    await logUnloadingCheck(w.deps, vw.port, yard(), { visitId: VIS, unloaded: true, unloadLocation: 'Bay 3' })
    await checkIn(sec(), { visitId: VIS2, vehicleId: V2, requestId: REQ2 }).catch(() => undefined)
    vw.penaltiesIssued.push({ tenantId: 'T1', contractorId: 'C1', issuedAt: NOW_MS }, { tenantId: 'T1', contractorId: 'C2', issuedAt: NOW_MS }, { tenantId: 'T1', contractorId: 'C1', issuedAt: NOW_MS - 3 * 86_400_000 })
  })

  it('gives every role only its own tiles', async () => {
    const tiles = async (c: ReturnType<typeof sec>) => Object.keys((await getDailySummary(w.deps, vw.port, c)).tiles).sort()
    expect(await tiles(admin())).toEqual(['awaitingUnload', 'checkIns', 'checkOuts', 'dwellWarnings', 'onSite', 'suspensions', 'unloads'])
    expect(await tiles(sec())).toEqual(['checkIns', 'checkOuts', 'dwellWarnings', 'onSite'])
    expect(await tiles(yard())).toEqual(['awaitingUnload', 'dwellWarnings', 'onSite', 'unloads'])
    expect(await tiles(caller('safe1', 'safety'))).toEqual(['checkIns', 'dwellWarnings', 'suspensions'])
    expect(await tiles(caller('officer', 'officer'))).toHaveLength(7)
  })

  it('counts today in the company timezone, scoped for a supervisor', async () => {
    expect((await getDailySummary(w.deps, vw.port, admin())).tiles).toMatchObject({ checkIns: 1, unloads: 1, checkOuts: 0, onSite: 1, awaitingUnload: 0, suspensions: 2 })
    expect((await getDailySummary(w.deps, vw.port, sup1())).tiles).toMatchObject({ checkIns: 1, suspensions: 1 })
    expect((await getDailySummary(w.deps, vw.port, sup2())).tiles).toMatchObject({ checkIns: 0, onSite: 0, suspensions: 1 })
  })

  it('lists dwell warnings with hours on site and the limit in force', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', dwellLimitHours: 10 })
    await flagDwellVisits(vw.dwell, NOW_MS + 11 * 3_600_000)
    const s = await getDailySummary(w.deps, vw.port, admin())
    expect(s.dwellLimitHours).toBe(10)
    expect(s.dwell).toEqual([{ visitId: VIS, plateNo: 'WP LJ-4821', driverName: 'Name', checkInAt: NOW_MS, hours: 0 }])
    expect(s.tiles.dwellWarnings).toBe(1)
  })

  it('leaves out a tile whose query fails instead of failing the whole summary', async () => {
    const port = { ...vw.port, countPenaltiesIssued: async () => Promise.reject(new Error('missing index')) }
    const s = await getDailySummary(w.deps, port, admin())
    expect(s.tiles.suspensions).toBeUndefined()
    expect(s.tiles).toMatchObject({ checkIns: 1, unloads: 1, onSite: 1 })
  })

  it('fails only when nothing at all could be counted', async () => {
    const boom = async () => Promise.reject(new Error('down'))
    const port = { ...vw.port, countStage: boom, countActive: boom, countPenaltiesIssued: boom, listDwell: boom }
    await expect(getDailySummary(w.deps, port, admin())).rejects.toThrow('down')
  })

  it('is for the roles that work with visits only', async () => {
    for (const c of [drv1()]) await rejects(getDailySummary(w.deps, vw.port, c), 'permission-denied', 'forbidden')
  })
})

describe('flagDwellVisits', () => {
  beforeEach(async () => {
    await checkIn()
  })
  const hours = (h: number) => NOW_MS + h * 3_600_000

  it('flags a visit still checked in at 16 hours (default), not before, and never twice', async () => {
    expect(await flagDwellVisits(vw.dwell, hours(15.99))).toMatchObject({ flagged: 0 })
    expect(vw.visits.get(VIS)?.dwellWarning).toBe(false)
    expect(await flagDwellVisits(vw.dwell, hours(16))).toMatchObject({ flagged: 1 })
    expect(vw.visits.get(VIS)).toMatchObject({ dwellWarning: true, dwellWarningAt: hours(16), status: 'checked_in' })
    expect(await flagDwellVisits(vw.dwell, hours(17))).toMatchObject({ flagged: 0 })
    expect(w.audits.filter((a) => a.action === 'visit.dwellWarning')).toHaveLength(1)
  })

  it('uses the company limit, one value to change', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', dwellLimitHours: 24 })
    expect((await flagDwellVisits(vw.dwell, hours(20))).flagged).toBe(0)
    expect((await flagDwellVisits(vw.dwell, hours(24))).flagged).toBe(1)
  })

  it('ignores visits that already left and blocks nothing', async () => {
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    expect((await flagDwellVisits(vw.dwell, hours(40))).flagged).toBe(0)
  })

  it('a flagged visit can still be unloaded and checked out', async () => {
    await flagDwellVisits(vw.dwell, hours(20))
    await logUnloadingCheck(w.deps, vw.port, yard(), { visitId: VIS, unloaded: false })
    await checkOutVisit(w.deps, vw.port, sec(), { visitId: VIS, requestId: REQ2 })
    expect(vw.visits.get(VIS)).toMatchObject({ status: 'checked_out', dwellWarning: true })
  })
})

describe('dayBoundsMs', () => {
  it('spans exactly the tenant day', () => {
    const { from, to } = dayBoundsMs('Asia/Colombo', '20231115')
    expect(new Date(from).toISOString()).toBe('2023-11-14T18:30:00.000Z')
    expect(new Date(to).toISOString()).toBe('2023-11-15T18:29:59.999Z')
  })
})

describe('the Yard Officer account', () => {
  it('is created by the admin with a PIN, no email, no password and no contractor', async () => {
    const { uid, pin } = await createUser(w.deps, admin(), { role: 'yard', name: 'Yara Yard', phone: '0771234567' })
    expect(pin).toMatch(/^\d{8}$/)
    expect(w.users.get(uid)).toMatchObject({ role: 'yard', contractorId: null, email: null, loginType: 'pin', mustChangePassword: false })
    expect(w.claims.get(uid)).toEqual({ role: 'yard', tenantId: 'T1' })
    expect(w.pins.get(pinKey(pin as string, TEST_PEPPER))).toEqual({ uid, tenantId: 'T1', role: 'yard' })
    expect(w.drivers.has(uid)).toBe(false)
    expect(JSON.stringify(w.audits)).not.toContain(pin as string)
  })

  it('cannot be created by a supervisor, nor with an email or a password, nor under a contractor', async () => {
    await rejects(createUser(w.deps, sup1(), { role: 'yard', name: 'Yara' }), 'permission-denied', 'forbidden')
    await rejects(createUser(w.deps, admin(), { role: 'yard', name: 'Yara', email: 'y@x.com' }), 'invalid-argument', 'invalid-input')
    await rejects(createUser(w.deps, admin(), { role: 'yard', name: 'Yara', password: 'Sup3rSecret!pw' }), 'invalid-argument', 'invalid-input')
    await rejects(createUser(w.deps, admin(), { role: 'yard', name: 'Yara', contractorId: 'C1' }), 'invalid-argument', 'invalid-input')
  })

  it('gets a new PIN, never a password reset', async () => {
    const { uid } = await createUser(w.deps, admin(), { role: 'yard', name: 'Yara Yard' })
    const next = await reissuePin(w.deps, admin(), { uid })
    expect(next.pin).toMatch(/^\d{8}$/)
    await rejects(resetCredential(w.deps, admin(), { uid, newPassword: 'Sup3rSecret!pw' }), 'failed-precondition', 'pin-user')
  })

  it('signs in again after 16 hours (the session limit is enforced by every call)', async () => {
    const stale = caller('yard1', 'yard', null, { authTime: NOW - 16 * 3600 - 1 })
    await rejects(logUnloadingCheck(w.deps, vw.port, stale, { visitId: VIS, unloaded: false }), 'unauthenticated', 'session-expired')
    await rejects(getDailySummary(w.deps, vw.port, stale), 'unauthenticated', 'session-expired')
  })
})
