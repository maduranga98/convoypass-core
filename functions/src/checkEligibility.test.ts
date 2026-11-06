import { beforeEach, describe, expect, it } from 'vitest'
import { checkEligibility, evaluateEligibility } from './checkEligibility.js'
import { NOW, admin, caller, drv1, makeWorld, rejects, sup1, sup2, type World } from './test-utils.js'
import type { PenaltyData } from './types.js'

const VID = 'veh_aaaaaaaaaa'
const NOW_MS = NOW * 1000
const HOUR = 3_600_000

let w: World
beforeEach(() => {
  w = makeWorld()
  w.vehicles.set(VID, { tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
})

const penalty = (over: Partial<PenaltyData> = {}, id = `pen_${w.penalties.size}`): void => {
  w.penalties.set(id, {
    tenantId: 'T1', contractorId: 'C1', target: { driverId: null, vehicleId: VID }, targetLabels: { driverName: null, plateNo: 'WP LJ-4821' },
    typeId: 'pty_1', typeName: 'Safety Violation', duration: { kind: 'permanent' },
    issuedBy: { uid: 'safe1', name: 'Sam', role: 'safety' }, issuedAt: NOW_MS - HOUR, reason: 'Secret reason', evidencePhotoPath: null,
    status: 'active', verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
  })
}
const check = (c = caller('sec', 'security'), ref: Record<string, unknown> = { vehicleId: VID, driverId: 'drv1' }) => checkEligibility(w.deps, c, ref)

describe('checkEligibility: combining documents and penalties', () => {
  it('is valid with no penalties and no dates', async () => {
    expect(await check()).toMatchObject({ status: 'valid', blocked: false, vehicle: { documentStatus: 'valid', penalties: [] }, driver: { documentStatus: 'valid' }, checkedAt: NOW_MS })
  })

  it('reports the worst document status from the stored dates, live (not the denormalised field)', async () => {
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, insuranceExpiry: '2023-11-20', eligibilityStatus: 'valid' })
    expect(await check()).toMatchObject({ status: 'expiringSoon', vehicle: { documentStatus: 'expiringSoon' } })
    w.drivers.set('drv1', { ...w.drivers.get('drv1')!, licenseExpiry: '2023-11-01' })
    expect(await check()).toMatchObject({ status: 'expired', driver: { documentStatus: 'expired' } })
  })

  it('blocked overrides valid AND expired documents', async () => {
    w.drivers.set('drv1', { ...w.drivers.get('drv1')!, licenseExpiry: '2023-11-01' })
    penalty()
    expect(await check()).toMatchObject({ status: 'blocked', blocked: true })
  })

  it('a vehicle penalty blocks the vehicle only; a driver penalty the driver only; "both" blocks each', async () => {
    penalty({ target: { driverId: null, vehicleId: VID } })
    expect(await check()).toMatchObject({ blocked: true, vehicle: { blocked: true }, driver: { blocked: false } })
    w.penalties.clear()
    penalty({ target: { driverId: 'drv1', vehicleId: null } })
    expect(await check()).toMatchObject({ blocked: true, vehicle: { blocked: false }, driver: { blocked: true } })
    w.penalties.clear()
    penalty({ target: { driverId: 'drv1', vehicleId: VID } })
    expect(await check()).toMatchObject({ vehicle: { blocked: true }, driver: { blocked: true } })
    // Asking about the vehicle alone still sees the "both" penalty.
    expect(await check(caller('sec', 'security'), { vehicleId: VID })).toMatchObject({ blocked: true, driver: null })
  })

  it('does not block for expired or revoked penalties, nor for another vehicle’s penalty', async () => {
    penalty({ status: 'expired' })
    penalty({ status: 'revoked' })
    penalty({ target: { driverId: null, vehicleId: 'veh_other' } })
    expect((await check()).blocked).toBe(false)
  })

  it('a fixed penalty blocks through its last moment, and stops blocking the instant it passes even if the job has not run', async () => {
    penalty({ duration: { kind: 'fixed', endDate: NOW_MS } })
    expect((await check()).blocked).toBe(true)
    w.penalties.clear()
    penalty({ duration: { kind: 'fixed', endDate: NOW_MS - 1 } }) // still stored as `active`
    expect((await check()).blocked).toBe(false)
  })

  it('exposes type and end date of a blocking penalty, never its reason, issuer or photo', async () => {
    penalty({ duration: { kind: 'fixed', endDate: NOW_MS + HOUR }, evidencePhotoPath: 'tenants/T1/penalties/x/evidence.jpg' })
    const r = await check()
    expect(r.vehicle?.penalties).toEqual([{ id: expect.any(String), typeName: 'Safety Violation', permanent: false, endDate: NOW_MS + HOUR }])
    expect(JSON.stringify(r)).not.toMatch(/Secret reason|evidence\.jpg|Sam|safe1/)
  })

  it('needs a vehicle or a driver', async () => {
    await rejects(check(caller('sec', 'security'), {}), 'invalid-argument', 'invalid-input')
  })
})

describe('checkEligibility: drivers that predate Module 2', () => {
  it('works for a driver with only a users record (no drivers doc): documents are simply not tracked', async () => {
    w.users.set('legacy', { ...w.users.get('drv1')!, name: 'Old Timer' })
    expect(await check(caller('sec', 'security'), { driverId: 'legacy' })).toMatchObject({ status: 'valid', driver: { id: 'legacy', documentStatus: 'valid', blocked: false } })
    penalty({ target: { driverId: 'legacy', vehicleId: null } })
    expect(await check(caller('sec', 'security'), { driverId: 'legacy' })).toMatchObject({ status: 'blocked', driver: { blocked: true } })
  })

  it('a user that is not a driver, or another tenant’s driver, is not found', async () => {
    await rejects(check(caller('sec', 'security'), { driverId: 'sup1' }), 'not-found', 'user-not-found')
    await rejects(check(caller('sec', 'security'), { driverId: 'foreign' }), 'not-found', 'user-not-found')
  })
})

describe('checkEligibility: who and where', () => {
  it('security, safety, officer and admin see the whole company', async () => {
    for (const c of [caller('sec', 'security'), caller('safe1', 'safety'), caller('officer', 'officer'), admin()]) {
      expect((await check(c, { vehicleId: VID })).vehicle?.id).toBe(VID)
    }
  })

  it('a supervisor only for their own contractor; another’s looks missing', async () => {
    expect((await check(sup1())).vehicle?.id).toBe(VID)
    await rejects(check(sup2(), { vehicleId: VID }), 'not-found', 'vehicle-not-found')
    await rejects(check(sup2(), { driverId: 'drv1' }), 'not-found', 'user-not-found')
  })

  it('drivers cannot call it, and another tenant’s records look missing', async () => {
    await rejects(check(drv1()), 'permission-denied', 'forbidden')
    w.vehicles.set('veh_foreign', { ...w.vehicles.get(VID)!, tenantId: 'T2', contractorId: 'CX' })
    await rejects(check(admin(), { vehicleId: 'veh_foreign' }), 'not-found', 'vehicle-not-found')
    await rejects(check(admin(), { driverId: 'foreign' }), 'not-found', 'user-not-found')
  })

  it('ignores penalties of another tenant that name the same ids', async () => {
    penalty({ tenantId: 'T2' })
    expect((await evaluateEligibility(w.deps, 'T1', { vehicleId: VID })).blocked).toBe(false)
  })
})
