import { beforeEach, describe, expect, it } from 'vitest'
import { recordInspection, withdrawClearance } from './inspections.js'
import { invalidateForPenalty, invalidateForVehicleExpiry } from './inspectionInvalidation.js'
import { blockForClearance, blockForDriverExpiry, blockForPenalty, blockForVehicleExpiry, type BlockingDeps } from './gatePassBlocking.js'
import {
  autoIssueGatePasses,
  blockGatePass,
  checkGatePassForCheckIn,
  computeQualification,
  computeQualificationLists,
  issueGatePasses,
  mapPool,
  reactivateGatePass,
  refreshQualificationList,
  rolloverGatePasses,
} from './gatePasses.js'
import { gatePassId } from './gatePassLogic.js'
import { givePass, makeGatePassWorld, NEXT_MONTH, TEST_MONTH, type GatePassWorld } from './gatepass-test-utils.js'
import { checkInVisit } from './visits.js'
import { giveCheckedInPass, makeVisitWorld, type VisitWorld } from './visits-test-utils.js'
import { NOW, admin, caller, makeWorld, rejects, sup1, type World } from './test-utils.js'
import type { GatePassData } from './gatePassLogic.js'
import type { DriverData, PenaltyData, UserData, VehicleData } from './types.js'

const NOW_MS = NOW * 1000
const V1 = 'veh_aaaaaaaaaa'
const V2 = 'veh_bbbbbbbbbb'

let w: World
let gp: GatePassWorld
let n = 0

const approve = async (vehicleId: string) =>
  (await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: `insp_${String(++n).padStart(10, 'a')}`, vehicleId, result: 'approved', notes: '' })).inspectionId

const penalty = (target: PenaltyData['target'], over: Partial<PenaltyData> = {}): PenaltyData => ({
  tenantId: 'T1', contractorId: 'C1', target, targetLabels: { driverName: null, plateNo: null }, typeId: 'pty_1', typeName: 'Safety Violation',
  duration: { kind: 'permanent' }, issuedBy: { uid: 'safe1', name: 'Sam', role: 'safety' }, issuedAt: NOW_MS + 1000, reason: 'Secret reason', evidencePhotoPath: null,
  status: 'active', verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
})

beforeEach(async () => {
  w = makeWorld()
  gp = makeGatePassWorld(w)
  const base = { tenantId: 'T1', contractorId: 'C1', type: 'Tipper', status: 'active' as const }
  w.vehicles.set(V1, { ...base, plateNo: 'WP A-1', plateKey: 'WPA1', assignedDriverIds: ['drv1', 'drv1b'] })
  w.vehicles.set(V2, { ...base, plateNo: 'WP B-2', plateKey: 'WPB2', assignedDriverIds: ['drv1'] })
  w.users.set('drv1b', { ...(w.users.get('drv1') as UserData), name: 'Second Driver' })
  await approve(V1)
  await approve(V2)
})

const blocking = (): BlockingDeps => ({ port: gp.port, data: w.deps.data })
const issue = (pairs: { vehicleId: string; driverId: string }[], month = TEST_MONTH, c = admin()) => issueGatePasses(w.deps, gp.port, c, { month, pairs })

describe('issueGatePasses', () => {
  it('issues an active pass per eligible pairing, with names, contractor and the issuing admin', async () => {
    const res = await issue([{ vehicleId: V1, driverId: 'drv1' }, { vehicleId: V1, driverId: 'drv1b' }])
    expect(res).toMatchObject({ issued: 2, results: [{ ok: true }, { ok: true }] })
    expect(gp.passes.get(gatePassId(TEST_MONTH, V1, 'drv1'))).toMatchObject({
      tenantId: 'T1', vehicleId: V1, driverId: 'drv1', contractorId: 'C1', plateNo: 'WP A-1', driverName: 'Name', month: TEST_MONTH, status: 'active',
      issuedAt: NOW_MS, issuedBy: { uid: 'admin' }, issueMode: 'manual', blockedReason: null, blockedAt: null,
    })
    expect(w.audits.filter((a) => a.action === 'gatePass.issue')).toHaveLength(2)
  })

  it('can issue for next month too, but not for any other month', async () => {
    expect((await issue([{ vehicleId: V1, driverId: 'drv1' }], NEXT_MONTH)).issued).toBe(1)
    await rejects(issue([{ vehicleId: V1, driverId: 'drv1' }], '2024-03'), 'invalid-argument', 'month-invalid')
    await rejects(issue([{ vehicleId: V1, driverId: 'drv1' }], '2023-10'), 'invalid-argument', 'month-invalid')
  })

  it('is idempotent: a retry changes nothing and reports the existing pass', async () => {
    await issue([{ vehicleId: V1, driverId: 'drv1' }])
    const again = await issue([{ vehicleId: V1, driverId: 'drv1' }])
    expect(again.results[0]).toMatchObject({ ok: true, existing: true })
    expect(gp.passes.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'gatePass.issue')).toHaveLength(1)
  })

  it('does not issue to a pairing that is not eligible (penalty, expired document, uninspected vehicle), one failure never fails the batch', async () => {
    w.penalties.set('pen_1', penalty({ driverId: 'drv1', vehicleId: null }))
    w.vehicles.set(V2, { ...(w.vehicles.get(V2) as VehicleData), clearance: undefined })
    const res = await issue([{ vehicleId: V1, driverId: 'drv1' }, { vehicleId: V1, driverId: 'drv1b' }, { vehicleId: V2, driverId: 'drv1' }])
    expect(res.results.map((r) => [r.ok, r.error])).toEqual([[false, 'not-eligible'], [true, undefined], [false, 'not-eligible']])
    expect(gp.passes.size).toBe(1)
  })

  it('refuses a pairing that is not assigned, a suspended vehicle, a suspended contractor, a disabled driver and a foreign vehicle', async () => {
    w.vehicles.set('veh_cccccccccc', { tenantId: 'T1', contractorId: 'C1', plateNo: 'S', plateKey: 'S', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'suspended' })
    w.vehicles.set('veh_dddddddddd', { tenantId: 'T1', contractorId: 'CS', plateNo: 'S2', plateKey: 'S2', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
    w.vehicles.set('veh_eeeeeeeeee', { tenantId: 'T2', contractorId: 'CX', plateNo: 'F', plateKey: 'F', type: 'Tipper', assignedDriverIds: ['foreign'], status: 'active' })
    w.users.set('drv1b', { ...(w.users.get('drv1') as UserData), status: 'disabled' })
    const res = await issue([
      { vehicleId: V2, driverId: 'drv1b' },
      { vehicleId: 'veh_cccccccccc', driverId: 'drv1' },
      { vehicleId: 'veh_dddddddddd', driverId: 'drv1' },
      { vehicleId: V1, driverId: 'drv1b' },
      { vehicleId: 'veh_eeeeeeeeee', driverId: 'foreign' },
    ])
    expect(res.results.map((r) => r.error)).toEqual(['driver-not-assigned', 'vehicle-suspended', 'contractor-suspended', 'driver-inactive', 'vehicle-not-found'])
    expect(gp.passes.size).toBe(0)
  })

  it('reports an existing blocked pass instead of replacing it', async () => {
    givePass(gp, V1, 'drv1', { status: 'blocked', blockedReason: 'penalty', blockedAt: NOW_MS })
    const res = await issue([{ vehicleId: V1, driverId: 'drv1' }])
    expect(res.results[0]).toMatchObject({ ok: false, error: 'gate-pass-exists' })
    expect(gp.passes.get(gatePassId(TEST_MONTH, V1, 'drv1'))?.status).toBe('blocked')
  })

  it('only the Company Admin may issue; nobody else, supervisor and safety included', async () => {
    for (const c of [sup1(), caller('safe1', 'safety'), caller('sec', 'security'), caller('officer', 'officer'), caller('drv1', 'driver', 'C1'), caller('yard1', 'yard')]) {
      await rejects(issue([{ vehicleId: V1, driverId: 'drv1' }], TEST_MONTH, c), 'permission-denied', 'forbidden')
    }
    expect(gp.passes.size).toBe(0)
  })

  it('removes issued pairings from the month-end list', async () => {
    await computeQualification(w.deps, gp.port, 'T1', TEST_MONTH, NOW_MS, 'manual')
    const q = () => gp.qualification.get(`T1_${TEST_MONTH}`)?.entries.size
    const before = q()
    await issue([{ vehicleId: V1, driverId: 'drv1' }])
    expect(q()).toBe((before ?? 0) - 1)
  })

  it('validates the input shape', async () => {
    await rejects(issueGatePasses(w.deps, gp.port, admin(), { month: TEST_MONTH, pairs: [] }), 'invalid-argument')
    await rejects(issueGatePasses(w.deps, gp.port, admin(), { month: 'soon', pairs: [{ vehicleId: V1, driverId: 'drv1' }] }), 'invalid-argument')
  })
})

describe('system blocking (the Module 4 triggers)', () => {
  beforeEach(async () => {
    await issue([{ vehicleId: V1, driverId: 'drv1' }, { vehicleId: V1, driverId: 'drv1b' }, { vehicleId: V2, driverId: 'drv1' }])
  })
  const status = (v: string, d: string, m = TEST_MONTH) => gp.passes.get(gatePassId(m, v, d))

  it('a driver penalty blocks that driver’s passes on every vehicle and no one else’s', async () => {
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', p)
    const res = await blockForPenalty(blocking(), 'pen_1', p, NOW_MS + 5000)
    expect(res).toEqual({ matched: 2, blocked: 2 })
    expect(status(V1, 'drv1')).toMatchObject({ status: 'blocked', blockedReason: 'penalty', blockedAt: NOW_MS + 5000 })
    expect(status(V2, 'drv1')).toMatchObject({ status: 'blocked', blockedReason: 'penalty' })
    expect(status(V1, 'drv1b')?.status).toBe('active')
    expect(w.audits.at(-1)).toMatchObject({ action: 'gatePass.block', actorUid: 'system', actorRole: 'system', targetType: 'gatePass', meta: { reason: 'penalty', source: 'pen_1' } })
  })

  it('a vehicle penalty blocks every pass of that vehicle', async () => {
    const p = penalty({ driverId: null, vehicleId: V1 })
    w.penalties.set('pen_1', p)
    expect(await blockForPenalty(blocking(), 'pen_1', p, NOW_MS)).toEqual({ matched: 2, blocked: 2 })
    expect(status(V2, 'drv1')?.status).toBe('active')
  })

  it('also blocks a pass issued for next month', async () => {
    await issue([{ vehicleId: V1, driverId: 'drv1' }], NEXT_MONTH)
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', p)
    await blockForPenalty(blocking(), 'pen_1', p, NOW_MS)
    expect(status(V1, 'drv1', NEXT_MONTH)?.status).toBe('blocked')
  })

  it('a penalty revoked before the trigger ran blocks nothing', async () => {
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', { ...p, status: 'revoked' })
    expect(await blockForPenalty(blocking(), 'pen_1', p, NOW_MS)).toEqual({ matched: 0, blocked: 0 })
    expect(status(V1, 'drv1')?.status).toBe('active')
  })

  it('is idempotent and keeps the FIRST reason (a second cause changes nothing)', async () => {
    const p = penalty({ driverId: null, vehicleId: V1 })
    w.penalties.set('pen_1', p)
    await blockForPenalty(blocking(), 'pen_1', p, NOW_MS)
    const audits = w.audits.length
    expect(await blockForPenalty(blocking(), 'pen_1', p, NOW_MS + 9)).toEqual({ matched: 0, blocked: 0 })
    w.vehicles.set(V1, { ...(w.vehicles.get(V1) as VehicleData), eligibilityStatus: 'expired' })
    expect(await blockForVehicleExpiry(blocking(), 'T1', V1, NOW_MS)).toEqual({ matched: 0, blocked: 0 })
    expect(w.audits).toHaveLength(audits)
    expect(status(V1, 'drv1')?.blockedReason).toBe('penalty')
  })

  it('an expired vehicle document blocks that vehicle’s passes; an unconfirmed expiry blocks nothing', async () => {
    expect(await blockForVehicleExpiry(blocking(), 'T1', V1, NOW_MS)).toEqual({ matched: 0, blocked: 0 })
    w.vehicles.set(V1, { ...(w.vehicles.get(V1) as VehicleData), eligibilityStatus: 'expired' })
    expect(await blockForVehicleExpiry(blocking(), 'T1', V1, NOW_MS)).toEqual({ matched: 2, blocked: 2 })
    expect(status(V1, 'drv1')).toMatchObject({ status: 'blocked', blockedReason: 'document_expired' })
  })

  it('an expired licence blocks the driver’s passes on every vehicle', async () => {
    w.drivers.set('drv1', { ...(w.drivers.get('drv1') as DriverData), eligibilityStatus: 'expired' })
    expect(await blockForDriverExpiry(blocking(), 'T1', 'drv1', NOW_MS)).toEqual({ matched: 2, blocked: 2 })
    expect(status(V2, 'drv1')?.blockedReason).toBe('document_expired')
    expect(status(V1, 'drv1b')?.status).toBe('active')
  })

  it('a withdrawn inspection blocks with inspection_invalidated; one cancelled by a penalty keeps reason penalty', async () => {
    await withdrawClearance(w.deps, caller('safe1', 'safety'), { vehicleId: V1, note: 'brakes' })
    expect(await blockForClearance(blocking(), 'T1', V1, NOW_MS)).toEqual({ matched: 2, blocked: 2 })
    expect(status(V1, 'drv1')?.blockedReason).toBe('inspection_invalidated')

    const p = penalty({ driverId: null, vehicleId: V2 })
    w.penalties.set('pen_2', p)
    await invalidateForPenalty(w.deps.data, 'pen_2', p, NOW_MS + 1000)
    await blockForClearance(blocking(), 'T1', V2, NOW_MS + 2000)
    expect(status(V2, 'drv1')?.blockedReason).toBe('penalty')
  })

  it('a rejected inspection blocks too; a cleared vehicle does not', async () => {
    expect(await blockForClearance(blocking(), 'T1', V1, NOW_MS)).toEqual({ matched: 0, blocked: 0 })
    await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: 'insp_zzzzzzzzzz', vehicleId: V1, result: 'rejected', notes: 'cracked chassis' })
    expect(await blockForClearance(blocking(), 'T1', V1, NOW_MS)).toMatchObject({ blocked: 2 })
  })

  it('works through the real inspection invalidation as well (the vehicle expiry path)', async () => {
    w.vehicles.set(V1, { ...(w.vehicles.get(V1) as VehicleData), eligibilityStatus: 'expired' })
    await invalidateForVehicleExpiry(w.deps.data, 'T1', V1, NOW_MS + 1, NOW_MS + 2)
    await blockForVehicleExpiry(blocking(), 'T1', V1, NOW_MS + 2)
    await blockForClearance(blocking(), 'T1', V1, NOW_MS + 2)
    expect(status(V1, 'drv1')?.blockedReason).toBe('document_expired')
  })

  it('never touches another company’s passes or an already expired one', async () => {
    givePass(gp, V1, 'drv1', { month: '2023-10', status: 'expired', tenantId: 'T1' })
    givePass(gp, 'veh_x', 'drv1', { tenantId: 'T2' })
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', p)
    await blockForPenalty(blocking(), 'pen_1', p, NOW_MS)
    expect(status(V1, 'drv1', '2023-10')?.status).toBe('expired')
    expect(gp.passes.get(gatePassId(TEST_MONTH, 'veh_x', 'drv1'))?.status).toBe('active')
  })
})

describe('blockGatePass and reactivateGatePass', () => {
  const id = gatePassId(TEST_MONTH, V1, 'drv1')
  beforeEach(async () => {
    await issue([{ vehicleId: V1, driverId: 'drv1' }])
  })

  it('the admin blocks an active pass with a note; a repeat is harmless; the note is required', async () => {
    await rejects(blockGatePass(w.deps, gp.port, admin(), { passId: id, note: '' }), 'invalid-argument')
    await blockGatePass(w.deps, gp.port, admin(), { passId: id, note: 'Seen speeding' })
    expect(gp.passes.get(id)).toMatchObject({ status: 'blocked', blockedReason: 'manual', blockNote: 'Seen speeding', blockedAt: NOW_MS })
    const audits = w.audits.length
    await blockGatePass(w.deps, gp.port, admin(), { passId: id, note: 'Seen speeding' })
    expect(w.audits).toHaveLength(audits)
    expect(w.audits.at(-1)).toMatchObject({ action: 'gatePass.block', actorUid: 'admin' })
  })

  it('only the admin blocks or reactivates; another company’s pass looks missing', async () => {
    for (const c of [sup1(), caller('safe1', 'safety'), caller('sec', 'security')]) {
      await rejects(blockGatePass(w.deps, gp.port, c, { passId: id, note: 'because' }), 'permission-denied', 'forbidden')
      await rejects(reactivateGatePass(w.deps, gp.port, c, { passId: id }), 'permission-denied', 'forbidden')
    }
    const other = { ...admin(), tenantId: 'T2' }
    await rejects(blockGatePass(w.deps, gp.port, other, { passId: id, note: 'because' }), 'permission-denied')
    await rejects(blockGatePass(w.deps, gp.port, admin(), { passId: 'nope', note: 'because' }), 'not-found', 'gate-pass-not-found')
  })

  it('reactivation is refused while the penalty is still in force, and says what is wrong', async () => {
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', p)
    await invalidateForPenalty(w.deps.data, 'pen_1', p, NOW_MS + 1000)
    await blockForPenalty(blocking(), 'pen_1', p, NOW_MS + 1000)
    await expect(reactivateGatePass(w.deps, gp.port, admin(), { passId: id })).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'issue-unresolved', causes: 'penalty,inspection_invalidated' },
    })
    expect(gp.passes.get(id)?.status).toBe('blocked')
  })

  it('reactivation needs the penalty gone AND the vehicle re-inspected; re-inspection alone does not bring the pass back', async () => {
    const p = penalty({ driverId: 'drv1', vehicleId: null })
    w.penalties.set('pen_1', p)
    await invalidateForPenalty(w.deps.data, 'pen_1', p, NOW_MS + 1000)
    await blockForPenalty(blocking(), 'pen_1', p, NOW_MS + 1000)

    await approve(V1) // Module 4 restores clearance...
    expect(gp.passes.get(id)?.status).toBe('blocked') // ...but the pass does NOT come back by itself
    await rejects(reactivateGatePass(w.deps, gp.port, admin(), { passId: id }), 'failed-precondition', 'issue-unresolved') // penalty still active

    w.penalties.set('pen_1', { ...p, status: 'revoked' })
    await reactivateGatePass(w.deps, gp.port, admin(), { passId: id })
    expect(gp.passes.get(id)).toMatchObject({
      status: 'active', blockedReason: null, blockedAt: null, blockNote: null,
      reactivation: { by: { uid: 'admin' }, at: NOW_MS, previousReason: 'penalty' },
    })
    expect(w.audits.at(-1)).toMatchObject({ action: 'gatePass.reactivate', actorUid: 'admin', meta: { previousReason: 'penalty' } })
  })

  it('reactivation also needs the vehicle, contractor and driver to be active', async () => {
    await blockGatePass(w.deps, gp.port, admin(), { passId: id, note: 'for a while' })
    w.users.set('drv1', { ...(w.users.get('drv1') as UserData), status: 'disabled' })
    await rejects(reactivateGatePass(w.deps, gp.port, admin(), { passId: id }), 'failed-precondition', 'driver-inactive')
  })

  it('a manual block with nothing wrong reactivates straight away', async () => {
    await blockGatePass(w.deps, gp.port, admin(), { passId: id, note: 'for a while' })
    await reactivateGatePass(w.deps, gp.port, admin(), { passId: id })
    expect(gp.passes.get(id)?.status).toBe('active')
    await reactivateGatePass(w.deps, gp.port, admin(), { passId: id }) // a repeated click
  })

  it('an expired pass or a pass of a past month cannot be reactivated or blocked', async () => {
    const old = givePass(gp, V2, 'drv1', { month: '2023-10', status: 'blocked', blockedReason: 'penalty' })
    await rejects(reactivateGatePass(w.deps, gp.port, admin(), { passId: old }), 'failed-precondition', 'gate-pass-over')
    const exp = givePass(gp, V2, 'drv1', { status: 'expired' })
    await rejects(blockGatePass(w.deps, gp.port, admin(), { passId: exp, note: 'because' }), 'failed-precondition', 'gate-pass-over')
  })

  it('an active pass cannot be "reactivated" into an error, and a never-blocked pass is not blocked-only', async () => {
    await reactivateGatePass(w.deps, gp.port, admin(), { passId: id })
    expect(gp.passes.get(id)?.status).toBe('active')
  })
})

describe('rolloverGatePasses', () => {
  it('expires last month’s active and blocked passes, keeps the block reason, and leaves this month alone', async () => {
    const a = givePass(gp, V1, 'drv1', { month: '2023-10' })
    const b = givePass(gp, V1, 'drv1b', { month: '2023-10', status: 'blocked', blockedReason: 'penalty', blockedAt: 5 })
    const cur = givePass(gp, V2, 'drv1')
    const done = givePass(gp, V2, 'drv1', { month: '2023-09', status: 'expired' })
    const res = await rolloverGatePasses(w.deps, gp.port, NOW_MS)
    expect(res).toMatchObject({ expired: 2, autoIssued: 0, failedTenants: 0 })
    expect(gp.passes.get(a)).toMatchObject({ status: 'expired', expiredAt: NOW_MS })
    expect(gp.passes.get(b)).toMatchObject({ status: 'expired', blockedReason: 'penalty' })
    expect(gp.passes.get(cur)?.status).toBe('active')
    expect(gp.passes.get(done)?.expiredAt).toBeNull()
    expect(w.audits.filter((x) => x.action === 'gatePass.expire')).toHaveLength(1)
  })

  it('runs once per tenant per month and is idempotent', async () => {
    givePass(gp, V1, 'drv1', { month: '2023-10' })
    await rolloverGatePasses(w.deps, gp.port, NOW_MS)
    expect(w.tenants.get('T1')?.gatePassRolloverMonth).toBe(TEST_MONTH)
    const late = givePass(gp, V1, 'drv1b', { month: '2023-10' }) // would be missed: the month is marked done
    expect((await rolloverGatePasses(w.deps, gp.port, NOW_MS)).tenants).toBe(0) // every tenant is marked: the run is a cheap no-op
    expect(gp.passes.get(late)?.status).toBe('active')
  })

  it('uses the company’s own timezone for "the month changed"', async () => {
    givePass(gp, V1, 'drv1', { month: '2023-11' })
    const lastInstantOfNovemberUtc = Date.UTC(2023, 10, 30, 23, 0) // already 1 December 04:30 in Colombo
    await rolloverGatePasses(w.deps, gp.port, lastInstantOfNovemberUtc)
    expect(gp.passes.get(gatePassId('2023-11', V1, 'drv1'))?.status).toBe('expired')
    w.tenants.set('T1', { timezone: 'America/New_York' }) // 18:00 on 30 November there
    gp.passes.set(gatePassId('2023-11', V1, 'drv1'), { ...(gp.passes.get(gatePassId('2023-11', V1, 'drv1')) as GatePassData), status: 'active' })
    await rolloverGatePasses(w.deps, gp.port, lastInstantOfNovemberUtc)
    expect(gp.passes.get(gatePassId('2023-11', V1, 'drv1'))?.status).toBe('active')
  })

  it('does NOT auto-issue when the setting is off (the default)', async () => {
    await rolloverGatePasses(w.deps, gp.port, NOW_MS)
    expect([...gp.passes.values()].filter((p) => p.issueMode === 'auto')).toHaveLength(0)
  })

  it('auto-issues the qualified list at rollover when the company switched it on, and only to eligible pairings', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', autoIssueGatePasses: true, qualificationTypes: [] })
    w.penalties.set('pen_1', penalty({ driverId: 'drv1b', vehicleId: null }))
    const res = await rolloverGatePasses(w.deps, gp.port, NOW_MS)
    expect(res.autoIssued).toBe(2) // (V1,drv1) and (V2,drv1); drv1b has a penalty
    const autos = [...gp.passes.values()].filter((p) => p.issueMode === 'auto')
    expect(autos.map((p) => `${p.vehicleId}/${p.driverId}`).sort()).toEqual([`${V1}/drv1`, `${V2}/drv1`])
    expect(autos[0]).toMatchObject({ status: 'active', month: TEST_MONTH, issuedBy: { uid: 'system' } })
    expect(w.audits.filter((a) => a.action === 'gatePass.issue' && a.actorRole === 'system')).toHaveLength(2)
  })

  it('auto-issue skips pairings that already have a pass and never creates a second one', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', autoIssueGatePasses: true, qualificationTypes: [] })
    givePass(gp, V1, 'drv1', { issueMode: 'manual' })
    expect(await autoIssueGatePasses(w.deps, gp.port, 'T1', TEST_MONTH, NOW_MS)).toMatchObject({ issued: 2 })
    expect(await autoIssueGatePasses(w.deps, gp.port, 'T1', TEST_MONTH, NOW_MS)).toMatchObject({ issued: 0 })
    expect(gp.passes.size).toBe(3)
  })
})

describe('qualification list', () => {
  it('lists eligible pairings with no pass yet; counts the rest; stores the list rather than computing on read', async () => {
    givePass(gp, V1, 'drv1b', { month: NEXT_MONTH })
    w.penalties.set('pen_1', penalty({ driverId: 'drv1', vehicleId: null }))
    const { meta, entries } = await computeQualification(w.deps, gp.port, 'T1', NEXT_MONTH, NOW_MS, 'schedule')
    expect(entries).toHaveLength(0)
    expect(meta).toMatchObject({ month: NEXT_MONTH, evaluatedCount: 3, qualifiedCount: 0, alreadyIssuedCount: 1, notEligibleCount: 2, failedCount: 0, truncated: false, trigger: 'schedule' })

    w.penalties.clear()
    const second = await computeQualification(w.deps, gp.port, 'T1', NEXT_MONTH, NOW_MS, 'schedule')
    expect(second.entries.map((e) => `${e.vehicleId}/${e.driverId}`).sort()).toEqual([`${V1}/drv1`, `${V2}/drv1`])
    expect(second.entries[0]).toMatchObject({ tenantId: 'T1', month: NEXT_MONTH, contractorId: 'C1', plateNo: expect.any(String), driverName: 'Name', documentStatus: 'valid', computedAt: NOW_MS })
    expect(gp.qualification.get(`T1_${NEXT_MONTH}`)?.entries.size).toBe(2)
  })

  it('a recomputation drops pairings that no longer qualify', async () => {
    await computeQualification(w.deps, gp.port, 'T1', NEXT_MONTH, NOW_MS, 'manual')
    expect(gp.qualification.get(`T1_${NEXT_MONTH}`)?.entries.size).toBe(3)
    w.penalties.set('pen_1', penalty({ driverId: null, vehicleId: V1 }))
    await computeQualification(w.deps, gp.port, 'T1', NEXT_MONTH, NOW_MS, 'manual')
    expect(gp.qualification.get(`T1_${NEXT_MONTH}`)?.entries.size).toBe(1)
  })

  it('excludes uninspected vehicles, suspended vehicles and contractors, and disabled drivers', async () => {
    w.vehicles.set('veh_cccccccccc', { tenantId: 'T1', contractorId: 'C1', plateNo: 'S', plateKey: 'S', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' }) // never inspected
    w.vehicles.set('veh_dddddddddd', { tenantId: 'T1', contractorId: 'CS', plateNo: 'S2', plateKey: 'S2', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
    w.users.set('drv1b', { ...(w.users.get('drv1') as UserData), status: 'disabled' })
    const { entries, meta } = await computeQualification(w.deps, gp.port, 'T1', NEXT_MONTH, NOW_MS, 'manual')
    expect(entries.map((e) => `${e.vehicleId}/${e.driverId}`).sort()).toEqual([`${V1}/drv1`, `${V2}/drv1`])
    expect(meta.notEligibleCount).toBe(1)
  })

  it('refreshQualificationList is admin only and limited to this month and next', async () => {
    expect((await refreshQualificationList(w.deps, gp.port, admin(), { month: NEXT_MONTH })).qualifiedCount).toBe(3)
    await rejects(refreshQualificationList(w.deps, gp.port, sup1(), { month: NEXT_MONTH }), 'permission-denied', 'forbidden')
    await rejects(refreshQualificationList(w.deps, gp.port, admin(), { month: '2025-01' }), 'invalid-argument', 'month-invalid')
  })

  it('the schedule computes next month’s list only in the last days of the company’s month', async () => {
    const early = Date.UTC(2023, 10, 15, 6)
    expect(await computeQualificationLists(w.deps, gp.port, early)).toMatchObject({ computed: 0 })
    const late = Date.UTC(2023, 10, 28, 6) // 28 November, Colombo
    const res = await computeQualificationLists(w.deps, gp.port, late)
    expect(res).toMatchObject({ computed: 2, failedTenants: 0 }) // T1 and T2 (default timezone)
    expect(gp.qualification.get(`T1_${NEXT_MONTH}`)?.meta.trigger).toBe('schedule')
  })

  it('mapPool keeps order and the concurrency bound', async () => {
    let live = 0
    let peak = 0
    const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (x) => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 2))
      live--
      return x * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('check-in integration (Module 5)', () => {
  let vw: VisitWorld
  const checkIn = (over: Record<string, unknown> = {}) =>
    checkInVisit(w.deps, vw.port, caller('sec', 'security'), { visitId: 'vis_aaaaaaaaaa', vehicleId: V1, requestId: '3f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f', ...over })
  beforeEach(() => {
    vw = makeVisitWorld(w)
    vw.gatePasses = gp
    vw.port = { ...vw.port, lookupForPairing: (...a) => gp.port.lookupForPairing(...a) }
    giveCheckedInPass(w, V1, 'drv1')
  })

  it('no pass this month and never one before: "none"', async () => {
    const res = await checkIn()
    expect(res).toMatchObject({ outcome: 'no_gate_pass', gatePass: { state: 'none', month: TEST_MONTH }, plateNo: 'WP A-1' })
    expect(vw.visits.size).toBe(0)
    expect(w.audits.at(-1)).toMatchObject({ action: 'visit.checkInBlocked', meta: { gatePass: 'none', gatePassReason: null } })
  })

  it('only an earlier month’s pass: "expired"', async () => {
    givePass(gp, V1, 'drv1', { month: '2023-10', status: 'expired' })
    expect(await checkIn()).toMatchObject({ outcome: 'no_gate_pass', gatePass: { state: 'expired' } })
  })

  it('a blocked pass: "blocked" with its reason, even though the vehicle is eligible again', async () => {
    givePass(gp, V1, 'drv1', { status: 'blocked', blockedReason: 'penalty', blockedAt: NOW_MS })
    expect(await checkIn()).toMatchObject({ outcome: 'no_gate_pass', gatePass: { state: 'blocked', reason: 'penalty' } })
    expect(w.audits.at(-1)).toMatchObject({ meta: { gatePass: 'blocked', gatePassReason: 'penalty' } })
  })

  it('an active pass of this month lets the vehicle in', async () => {
    givePass(gp, V1, 'drv1')
    expect(await checkIn()).toMatchObject({ outcome: 'checked_in' })
  })

  it('a pass for the same vehicle but ANOTHER driver does not cover this pairing; neither does next month’s', async () => {
    givePass(gp, V1, 'drv1b')
    givePass(gp, V1, 'drv1', { month: NEXT_MONTH })
    expect(await checkIn()).toMatchObject({ outcome: 'no_gate_pass', gatePass: { state: 'none' } })
  })

  it('eligibility comes first: an ineligible vehicle shows the eligibility reasons, not the pass', async () => {
    givePass(gp, V1, 'drv1')
    w.penalties.set('pen_1', penalty({ driverId: 'drv1', vehicleId: null }))
    expect(await checkIn()).toMatchObject({ outcome: 'blocked' })
  })

  it('checkGatePassForCheckIn answers from one lookup', async () => {
    givePass(gp, V1, 'drv1')
    gp.lookups = 0
    expect(await checkGatePassForCheckIn(gp.port, w.tenants.get('T1') ?? null, 'T1', V1, 'drv1', NOW_MS)).toEqual({ state: 'active' })
    expect(gp.lookups).toBe(1)
  })
})
