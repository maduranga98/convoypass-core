import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateEligibility } from './checkEligibility.js'
import { recordQualification, setMyPermits } from './requirements.js'
import { DEFAULT_QUALIFICATION_TYPES } from './requirementLogic.js'
import { recordInspection } from './inspections.js'
import { updateTenantSettings } from './passes.js'
import { admin, caller, drv1, makeWorld, rejects, sup1, type World } from './test-utils.js'

const VID = 'veh_aaaaaaaaaa'
const officer = () => caller('officer', 'officer')
// The shared fixture's "today" is 2023-11-15 in Colombo.
const TODAY = '2023-11-15'

let w: World
beforeEach(async () => {
  w = makeWorld()
  w.vehicles.set(VID, { tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
  w.tenants.set('T1', { timezone: 'Asia/Colombo', qualificationTypes: DEFAULT_QUALIFICATION_TYPES.map((t) => ({ ...t })) })
  // The shared eligibility also needs the Safety Officer's clearance (third layer).
  await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: 'insp_aaaaaaaaaa', vehicleId: VID, result: 'approved', notes: '' })
})

const record = (c = admin(), over: Record<string, unknown> = {}) => recordQualification(w.deps, c, { driverId: 'drv1', typeId: 'safety', completedOn: TODAY, ...over })
const eligible = () => evaluateEligibility(w.deps, 'T1', { vehicleId: VID, driverId: 'drv1' })

describe('recordQualification', () => {
  it('admin and officer record it; the server adds one year and audits it', async () => {
    expect(await record(admin())).toEqual({ expiresOn: '2024-11-15' })
    await record(officer(), { typeId: 'defensive_driving', completedOn: '2023-10-01' })
    const q = w.drivers.get('drv1')?.qualifications
    expect(q?.safety).toMatchObject({ completedOn: TODAY, expiresOn: '2024-11-15', recordedByUid: 'admin' })
    expect(q?.defensive_driving).toMatchObject({ expiresOn: '2024-10-01', recordedByUid: 'officer' })
    expect(w.audits.at(-1)).toMatchObject({ action: 'qualification.record', targetType: 'qualification', targetId: 'drv1' })
  })

  it('refuses other roles, unknown types, future dates, foreign and non-driver targets', async () => {
    await rejects(record(sup1()), 'permission-denied', 'forbidden')
    await rejects(record(drv1()), 'permission-denied', 'forbidden')
    await rejects(record(admin(), { typeId: 'nope' }), 'invalid-argument', 'qualification-unknown')
    await rejects(record(admin(), { completedOn: '2023-11-30' }), 'invalid-argument', 'date-future')
    await rejects(record(admin(), { driverId: 'foreign' }), 'not-found', 'user-not-found')
    await rejects(record(admin(), { driverId: 'sup1' }), 'not-found', 'user-not-found')
  })

  it('renewing replaces the earlier record', async () => {
    await record(admin(), { completedOn: '2022-12-01' })
    await record(admin(), { completedOn: TODAY })
    expect(w.drivers.get('drv1')?.qualifications?.safety?.completedOn).toBe(TODAY)
  })
})

describe('eligibility with qualifications', () => {
  it('a driver is not eligible until every required qualification is recorded and valid', async () => {
    let e = await eligible()
    expect(e.eligible).toBe(false)
    expect(e.driver?.qualifications).toEqual({ missing: ['Safety induction', 'Defensive driving (DD)', 'Work instruction'], expired: [], ok: false })
    for (const typeId of ['safety', 'defensive_driving', 'work_instruction']) await record(admin(), { typeId })
    e = await eligible()
    expect(e.driver?.qualifications?.ok).toBe(true)
    expect(e.eligible).toBe(true)
  })

  it('an expired qualification (recorded over a year ago) blocks again', async () => {
    for (const typeId of ['safety', 'defensive_driving', 'work_instruction']) await record(admin(), { typeId })
    await record(admin(), { typeId: 'safety', completedOn: '2022-11-14' })
    const e = await eligible()
    expect(e.driver?.qualifications).toMatchObject({ expired: ['Safety induction'], ok: false })
    expect(e.eligible).toBe(false)
  })

  it('the company can add and remove conditions', async () => {
    await updateTenantSettings(w.deps, admin(), { qualificationTypes: [{ id: 'hazmat', name: 'Hazmat handling' }] })
    expect(w.tenants.get('T1')?.qualificationTypes).toEqual([{ id: 'hazmat', name: 'Hazmat handling' }])
    expect((await eligible()).driver?.qualifications?.missing).toEqual(['Hazmat handling'])
    await updateTenantSettings(w.deps, admin(), { qualificationTypes: [] })
    expect((await eligible()).eligible).toBe(true)
    await rejects(updateTenantSettings(w.deps, admin(), { qualificationTypes: [{ id: 'a1', name: 'A' + 'b' }, { id: 'a1', name: 'Other' }] }), 'invalid-argument', 'invalid-input')
    await rejects(updateTenantSettings(w.deps, officer(), { qualificationTypes: [] }), 'permission-denied')
  })

  it('a missing annual inspection makes the vehicle not eligible', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', qualificationTypes: [] })
    expect((await eligible()).eligible).toBe(true)
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, annualInspectionExpiry: undefined })
    const e = await eligible()
    expect(e.vehicle?.annualInspection).toBe('missing')
    expect(e.eligible).toBe(false)
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, annualInspectionExpiry: '2023-11-14' })
    expect((await eligible()).vehicle?.annualInspection).toBe('expired')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, annualInspectionExpiry: '2023-11-15' })
    expect((await eligible()).eligible).toBe(true)
  })
})

describe('setMyPermits', () => {
  it('a driver saves one or two permit numbers valid for three months', async () => {
    const { permits } = await setMyPermits(w.deps, drv1(), { permits: [' ab  123 ', 'cd-456'] })
    expect(permits).toEqual([
      { number: 'AB 123', enteredOn: TODAY, expiresOn: '2024-02-15' },
      { number: 'CD-456', enteredOn: TODAY, expiresOn: '2024-02-15' },
    ])
    expect(w.drivers.get('drv1')?.permits).toEqual(permits)
  })

  it('keeps the date of a number that stays and allows clearing the list', async () => {
    w.drivers.set('drv1', { ...w.drivers.get('drv1')!, permits: [{ number: 'AB 123', enteredOn: '2023-10-01', expiresOn: '2024-01-01' }] })
    const { permits } = await setMyPermits(w.deps, drv1(), { permits: ['ab 123', 'new 77'] })
    expect(permits[0]).toEqual({ number: 'AB 123', enteredOn: '2023-10-01', expiresOn: '2024-01-01' })
    expect(permits[1]?.enteredOn).toBe(TODAY)
    expect((await setMyPermits(w.deps, drv1(), { permits: [] })).permits).toEqual([])
  })

  it('refuses three numbers, duplicates, junk and non-drivers; permits never block eligibility', async () => {
    await rejects(setMyPermits(w.deps, drv1(), { permits: ['AAA', 'BBB', 'CCC'] }), 'invalid-argument')
    await rejects(setMyPermits(w.deps, drv1(), { permits: ['AAA', 'aaa'] }), 'invalid-argument', 'permit-invalid')
    await rejects(setMyPermits(w.deps, drv1(), { permits: ['A'] }), 'invalid-argument', 'permit-invalid')
    await rejects(setMyPermits(w.deps, admin(), { permits: ['AAA'] }), 'permission-denied', 'forbidden')
    w.tenants.set('T1', { timezone: 'Asia/Colombo', qualificationTypes: [] })
    expect((await eligible()).eligible).toBe(true)
  })
})
