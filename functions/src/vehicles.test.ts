import { beforeEach, describe, expect, it } from 'vitest'
import { newVehicleId } from './ids.js'
import {
  createVehicle,
  importVehicles,
  setContractorStatus,
  setVehicleDrivers,
  setVehicleStatus,
  updateVehicle,
} from './vehicles.js'
import { admin, caller, makeWorld, rejects, sup1, sup2, type World } from './test-utils.js'
import type { UserData, VehicleData } from './types.js'

let w: World
beforeEach(() => {
  w = makeWorld()
})

const create = (c = admin(), over: Record<string, unknown> = {}) =>
  createVehicle(w.deps, c, { contractorId: 'C1', plateNo: 'WP LJ-4821', type: 'Tipper', annualInspectionExpiry: '2099-12-31', ...over })

describe('newVehicleId', () => {
  it('is veh_ + 10 chars of [a-z0-9], and differs between calls', () => {
    const ids = new Set(Array.from({ length: 500 }, newVehicleId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^veh_[a-z0-9]{10}$/)
  })
})

describe('createVehicle', () => {
  it('admin creates a vehicle: normalised plate, guard reserved, active, no drivers, audited', async () => {
    const { vehicleId, plateNo } = await create(admin(), { plateNo: ' wp  lj-4821 ', makeModel: ' Tata ' })
    expect(plateNo).toBe('WP LJ-4821')
    expect(vehicleId).toMatch(/^veh_/)
    expect(w.vehicles.get(vehicleId)).toEqual({
      tenantId: 'T1',
      contractorId: 'C1',
      plateNo: 'WP LJ-4821',
      plateKey: 'WPLJ4821',
      type: 'Tipper',
      makeModel: 'Tata',
      assignedDriverIds: [],
      status: 'active',
      annualInspectionExpiry: '2099-12-31',
      eligibilityStatus: 'valid',
    })
    expect(w.plates.get('T1_WPLJ4821')).toBe(vehicleId)
    expect(w.audits.at(-1)).toMatchObject({ action: 'vehicle.create', targetType: 'vehicle', targetId: vehicleId, actorUid: 'admin' })
  })

  it('assigns drivers of the same contractor', async () => {
    const { vehicleId } = await create(admin(), { driverIds: ['drv1', 'drv1b', 'drv1'] })
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual(['drv1', 'drv1b'])
  })

  it('rejects drivers that are inactive, foreign, from another contractor or unknown, and creates nothing', async () => {
    for (const bad of ['drvOff', 'foreign', 'drv2', 'ghost']) {
      await rejects(create(admin(), { driverIds: [bad] }), 'failed-precondition', 'driver-invalid')
    }
    expect(w.vehicles.size).toBe(0)
    expect(w.plates.size).toBe(0)
  })

  it.each([
    ['same', 'WP LJ-4821'],
    ['lower case', 'wp lj-4821'],
    ['no spacing', 'WPLJ4821'],
    ['odd spacing', ' WP   LJ 4821 '],
  ])('rejects a duplicate plate (%s) with a friendly reason', async (_n, plate) => {
    await create()
    await rejects(create(admin(), { plateNo: plate }), 'already-exists', 'plate-exists')
    expect(w.vehicles.size).toBe(1)
  })

  it('is race-safe: concurrent creates of the same plate leave exactly one vehicle', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => create(admin(), { plateNo: 'CAB-1234' })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4)
    expect(w.vehicles.size).toBe(1)
    expect(w.plates.size).toBe(1)
  })

  it('the same plate may exist in another tenant', async () => {
    await create()
    w.users.set('adminT2', { ...(w.users.get('admin') as UserData), tenantId: 'T2' })
    w.contractors.set('CX', { tenantId: 'T2', status: 'active' })
    await createVehicle(w.deps, caller('adminT2', 'admin', null, { tenantId: 'T2' }), {
      contractorId: 'CX',
      plateNo: 'WP LJ-4821',
      type: 'Tipper',
    })
    expect(w.plates.size).toBe(2)
  })

  it('retries with a new id on an id collision', async () => {
    const { vehicleId: first } = await create(admin(), { plateNo: 'AAA-1111' })
    w.idQueue.push(first, 'veh_zzzzzzzzzz')
    const { vehicleId } = await create(admin(), { plateNo: 'BBB-2222' })
    expect(vehicleId).toBe('veh_zzzzzzzzzz')
    expect(w.vehicles.size).toBe(2)
  })

  it('supervisor: contractorId is forced to their own', async () => {
    const { vehicleId } = await create(sup1(), { contractorId: 'C2' })
    expect(w.vehicles.get(vehicleId)?.contractorId).toBe('C1')
  })

  it('admin must name a contractor', async () => {
    await rejects(create(admin(), { contractorId: undefined }), 'invalid-argument')
  })

  it('rejects suspended, missing and cross-tenant contractors', async () => {
    await rejects(create(admin(), { contractorId: 'CS' }), 'failed-precondition', 'contractor-invalid')
    await rejects(create(admin(), { contractorId: 'nope' }), 'failed-precondition', 'contractor-invalid')
    await rejects(create(admin(), { contractorId: 'CX' }), 'permission-denied', 'tenant-mismatch')
  })

  it('ignores a client-supplied tenantId', async () => {
    const { vehicleId } = await create(admin(), { tenantId: 'T2' })
    expect(w.vehicles.get(vehicleId)?.tenantId).toBe('T1')
    expect(w.plates.has('T1_WPLJ4821')).toBe(true)
  })

  it.each([
    ['officer', caller('officer', 'officer')],
    ['security', caller('sec', 'security')],
    ['driver', caller('drv1', 'driver', 'C1')],
  ])('%s cannot create vehicles', async (_n, c) => {
    await rejects(create(c), 'permission-denied', 'forbidden')
  })

  it('validates input', async () => {
    await rejects(create(admin(), { plateNo: 'A1' }), 'invalid-argument')
    await rejects(create(admin(), { plateNo: '!!!!' }), 'invalid-argument')
    await rejects(create(admin(), { plateNo: 'ABCDEFGHIJKLM' }), 'invalid-argument')
    await rejects(create(admin(), { type: 'Spaceship' }), 'invalid-argument')
    await rejects(create(admin(), { makeModel: 'x'.repeat(61) }), 'invalid-argument')
    await rejects(createVehicle(w.deps, admin(), null), 'invalid-argument')
  })

  it.each(['WP LJ-4821', 'NP KA 1234', 'CAB-1234', '250-1234'])('accepts the example plate %s', async (plate) => {
    await create(admin(), { plateNo: plate })
    expect(w.vehicles.size).toBe(1)
  })
})

describe('updateVehicle', () => {
  let id: string
  beforeEach(async () => {
    id = (await create()).vehicleId
  })

  it('moves the plate guard when the plate changes', async () => {
    await updateVehicle(w.deps, admin(), { vehicleId: id, plateNo: 'cab 9999' })
    expect(w.vehicles.get(id)).toMatchObject({ plateNo: 'CAB 9999', plateKey: 'CAB9999' })
    expect(w.plates.has('T1_WPLJ4821')).toBe(false)
    expect(w.plates.get('T1_CAB9999')).toBe(id)
    // the old plate is free again
    await create(admin(), { plateNo: 'WP LJ-4821' })
  })

  it('rejects a plate that another vehicle holds and leaves everything as it was', async () => {
    await create(admin(), { plateNo: 'CAB-1234' })
    await rejects(updateVehicle(w.deps, admin(), { vehicleId: id, plateNo: 'cab1234' }), 'already-exists', 'plate-exists')
    expect(w.vehicles.get(id)?.plateKey).toBe('WPLJ4821')
    expect(w.plates.get('T1_WPLJ4821')).toBe(id)
  })

  it('a spacing-only change keeps the guard', async () => {
    await updateVehicle(w.deps, admin(), { vehicleId: id, plateNo: 'wplj-4821' })
    expect(w.vehicles.get(id)?.plateNo).toBe('WPLJ-4821')
    expect(w.plates.get('T1_WPLJ4821')).toBe(id)
    expect(w.plates.size).toBe(1)
  })

  it('updates type and makeModel; an empty makeModel clears it', async () => {
    await updateVehicle(w.deps, admin(), { vehicleId: id, type: 'Lorry', makeModel: 'Isuzu' })
    expect(w.vehicles.get(id)).toMatchObject({ type: 'Lorry', makeModel: 'Isuzu' })
    await updateVehicle(w.deps, admin(), { vehicleId: id, makeModel: '' })
    expect(w.vehicles.get(id)).not.toHaveProperty('makeModel')
    expect(w.audits.at(-1)).toMatchObject({ action: 'vehicle.update', targetId: id })
  })

  it('never changes contractor, tenant or id', async () => {
    await updateVehicle(w.deps, admin(), { vehicleId: id, type: 'Lorry', contractorId: 'C2', tenantId: 'T2', plateKey: 'X' })
    expect(w.vehicles.get(id)).toMatchObject({ contractorId: 'C1', tenantId: 'T1', plateKey: 'WPLJ4821' })
  })

  it('supervisor: own contractor only', async () => {
    await updateVehicle(w.deps, sup1(), { vehicleId: id, type: 'Flatbed' })
    await rejects(updateVehicle(w.deps, sup2(), { vehicleId: id, type: 'Lorry' }), 'permission-denied', 'forbidden')
    expect(w.vehicles.get(id)?.type).toBe('Flatbed')
  })

  it('404s for unknown vehicles, rejects other tenants and non-managers', async () => {
    await rejects(updateVehicle(w.deps, admin(), { vehicleId: 'veh_0000000000', type: 'Lorry' }), 'not-found', 'vehicle-not-found')
    w.vehicles.set('veh_xxxxxxxxxx', { ...(w.vehicles.get(id) as VehicleData), tenantId: 'T2' })
    await rejects(updateVehicle(w.deps, admin(), { vehicleId: 'veh_xxxxxxxxxx', type: 'Lorry' }), 'permission-denied', 'tenant-mismatch')
    await rejects(updateVehicle(w.deps, caller('officer', 'officer'), { vehicleId: id, type: 'Lorry' }), 'permission-denied', 'forbidden')
    await rejects(updateVehicle(w.deps, admin(), { vehicleId: 'bad-id', type: 'Lorry' }), 'invalid-argument')
    await rejects(updateVehicle(w.deps, admin(), { vehicleId: id }), 'invalid-argument')
  })
})

describe('setVehicleStatus', () => {
  it('suspends and re-activates, with audit entries; supervisors can do neither', async () => {
    const { vehicleId } = await create()
    await setVehicleStatus(w.deps, admin(), { vehicleId, status: 'suspended' })
    expect(w.vehicles.get(vehicleId)?.status).toBe('suspended')
    expect(w.audits.at(-1)?.action).toBe('vehicle.suspend')
    await rejects(setVehicleStatus(w.deps, sup2(), { vehicleId, status: 'active' }), 'permission-denied', 'forbidden')
    await rejects(setVehicleStatus(w.deps, sup1(), { vehicleId, status: 'active' }), 'permission-denied', 'forbidden')
    expect(w.vehicles.get(vehicleId)?.status).toBe('suspended')
    await setVehicleStatus(w.deps, admin(), { vehicleId, status: 'active' })
    expect(w.vehicles.get(vehicleId)?.status).toBe('active')
    expect(w.audits.at(-1)?.action).toBe('vehicle.activate')
    await rejects(setVehicleStatus(w.deps, admin(), { vehicleId, status: 'deleted' }), 'invalid-argument')
  })
})

describe('annual inspection', () => {
  it('a vehicle with no annual inspection, or an expired one, cannot be given drivers', async () => {
    await rejects(create(admin(), { annualInspectionExpiry: '2023-11-01', driverIds: ['drv1'] }), 'failed-precondition', 'annual-inspection-invalid')
    const { vehicleId } = await create(admin())
    w.vehicles.set(vehicleId, { ...(w.vehicles.get(vehicleId) as VehicleData), annualInspectionExpiry: undefined }) // legacy vehicle: never inspected
    await rejects(setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: ['drv1'] }), 'failed-precondition', 'annual-inspection-invalid')
    await updateVehicle(w.deps, admin(), { vehicleId, annualInspectionExpiry: '2099-12-31' })
    await setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: ['drv1'] })
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual(['drv1'])
  })

  it('an expired annual inspection makes the vehicle expired, and removing drivers is still allowed', async () => {
    const { vehicleId } = await create(admin(), { driverIds: ['drv1'] })
    await updateVehicle(w.deps, admin(), { vehicleId, annualInspectionExpiry: '2023-11-01' })
    expect(w.vehicles.get(vehicleId)?.eligibilityStatus).toBe('expired')
    await setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: [] })
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual([])
  })
})

describe('one vehicle per driver', () => {
  it('refuses a driver who is already on another vehicle, on create and on assign', async () => {
    await create(admin(), { driverIds: ['drv1'] })
    await rejects(create(admin(), { plateNo: 'WP CC-1111', driverIds: ['drv1'] }), 'failed-precondition', 'driver-assigned')
    const { vehicleId } = await create(admin(), { plateNo: 'WP CC-2222' })
    await rejects(setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: ['drv1'] }), 'failed-precondition', 'driver-assigned')
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual([])
  })

  it('keeps a driver on their own vehicle, and frees them once removed', async () => {
    const { vehicleId } = await create(admin(), { driverIds: ['drv1'] })
    await setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: ['drv1', 'drv1b'] })
    await setVehicleDrivers(w.deps, admin(), { vehicleId, driverIds: ['drv1b'] })
    const other = await create(admin(), { plateNo: 'WP CC-3333' })
    await setVehicleDrivers(w.deps, admin(), { vehicleId: other.vehicleId, driverIds: ['drv1'] })
    expect(w.vehicles.get(other.vehicleId)?.assignedDriverIds).toEqual(['drv1'])
  })
})

describe('setVehicleDrivers', () => {
  let id: string
  beforeEach(async () => {
    id = (await create(admin(), { driverIds: ['drv1'] })).vehicleId
  })

  it('replaces the list', async () => {
    await setVehicleDrivers(w.deps, sup1(), { vehicleId: id, driverIds: ['drv1b'] })
    expect(w.vehicles.get(id)?.assignedDriverIds).toEqual(['drv1b'])
    await setVehicleDrivers(w.deps, admin(), { vehicleId: id, driverIds: [] })
    expect(w.vehicles.get(id)?.assignedDriverIds).toEqual([])
    expect(w.audits.at(-1)).toMatchObject({ action: 'vehicle.setDrivers', meta: { count: 0 } })
  })

  it('rejects drivers from other contractors, tenants, disabled or unknown ones, leaving the list unchanged', async () => {
    for (const bad of ['drv2', 'foreign', 'drvOff', 'ghost']) {
      await rejects(setVehicleDrivers(w.deps, admin(), { vehicleId: id, driverIds: ['drv1', bad] }), 'failed-precondition', 'driver-invalid')
    }
    expect(w.vehicles.get(id)?.assignedDriverIds).toEqual(['drv1'])
  })

  it('supervisor of another contractor cannot act', async () => {
    await rejects(setVehicleDrivers(w.deps, sup2(), { vehicleId: id, driverIds: ['drv2'] }), 'permission-denied', 'forbidden')
  })
})

describe('importVehicles', () => {
  const rows = [
    { plateNo: 'WP LJ-4821', type: 'Bulk Tanker', makeModel: 'Tata' },
    { plateNo: 'A1', type: 'Tipper' },
    { plateNo: 'CAB-1234', type: 'Spaceship' },
    { plateNo: 'wplj4821', type: 'Tipper' }, // duplicate of row 1
    { plateNo: 'NP KA 1234', type: 'Lorry', makeModel: 'x'.repeat(61) },
    { plateNo: '250-1234', type: 'Flatbed', makeModel: null },
  ]

  it('returns per-row results and never fails the batch for a bad row', async () => {
    const { results, created } = await importVehicles(w.deps, admin(), { contractorId: 'C1', rows })
    expect(created).toBe(2)
    expect(results.map((r) => [r.row, r.ok, r.error])).toEqual([
      [1, true, undefined],
      [2, false, 'invalid-plate'],
      [3, false, 'invalid-type'],
      [4, false, 'plate-exists'],
      [5, false, 'invalid-make-model'],
      [6, true, undefined],
    ])
    for (const r of results.filter((r) => r.ok)) expect(w.vehicles.get(r.vehicleId as string)).toMatchObject({ contractorId: 'C1', assignedDriverIds: [], status: 'active' })
    expect(w.vehicles.size).toBe(2)
    expect(w.audits.at(-1)).toMatchObject({ action: 'vehicle.import', meta: { rows: 6, created: 2, failed: 4 } })
  })

  it('reports a plate that already exists in the tenant', async () => {
    await create()
    const { results } = await importVehicles(w.deps, admin(), { contractorId: 'C2', rows: [{ plateNo: 'wp lj 4821', type: 'Tipper' }] })
    expect(results[0]).toEqual({ row: 1, ok: false, error: 'plate-exists' })
  })

  it('reports an internal error for a row whose write fails, and carries on', async () => {
    const original = w.deps.data.createVehicleTx
    let calls = 0
    w.deps.data.createVehicleTx = async (p) => {
      if (++calls === 1) throw new Error('boom')
      return original(p)
    }
    const { results } = await importVehicles(w.deps, admin(), {
      contractorId: 'C1',
      rows: [
        { plateNo: 'AAA-1111', type: 'Tipper' },
        { plateNo: 'BBB-2222', type: 'Tipper' },
      ],
    })
    expect(results.map((r) => [r.ok, r.error])).toEqual([
      [false, 'internal'],
      [true, undefined],
    ])
  })

  it('caps the batch at 200 rows and requires at least one', async () => {
    const row = { plateNo: 'ABCD-1234', type: 'Tipper' }
    await rejects(importVehicles(w.deps, admin(), { contractorId: 'C1', rows: Array(201).fill(row) }), 'invalid-argument')
    await rejects(importVehicles(w.deps, admin(), { contractorId: 'C1', rows: [] }), 'invalid-argument')
    const many = Array.from({ length: 200 }, (_, i) => ({ plateNo: `AB-${String(1000 + i)}`, type: 'Tipper' }))
    const { created } = await importVehicles(w.deps, admin(), { contractorId: 'C1', rows: many })
    expect(created).toBe(200)
  })

  it('supervisor imports into their own contractor only; suspended contractors are rejected', async () => {
    const { results } = await importVehicles(w.deps, sup1(), { contractorId: 'C2', rows: [{ plateNo: 'ABCD-1234', type: 'Tipper' }] })
    expect(w.vehicles.get(results[0]?.vehicleId as string)?.contractorId).toBe('C1')
    await rejects(importVehicles(w.deps, admin(), { contractorId: 'CS', rows: [{ plateNo: 'ABCD-1235', type: 'Tipper' }] }), 'failed-precondition', 'contractor-invalid')
    await rejects(importVehicles(w.deps, caller('officer', 'officer'), { contractorId: 'C1', rows }), 'permission-denied', 'forbidden')
  })
})

describe('setContractorStatus', () => {
  it('suspending updates the doc, revokes tokens of every user of that contractor only, and audits', async () => {
    const out = await setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'suspended' })
    expect(w.contractors.get('C1')?.status).toBe('suspended')
    expect(w.revoked.sort()).toEqual(['drv1', 'sup1'])
    expect(out.revoked).toBe(2)
    expect(w.audits.at(-1)).toMatchObject({ action: 'contractor.suspend', targetType: 'contractor', targetId: 'C1' })
  })

  it('does not disable Auth users or touch the users docs', async () => {
    await setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'suspended' })
    expect(w.users.get('drv1')?.status).toBe('active')
    expect(w.authUsers.size).toBe(0)
  })

  it('activating changes the doc only: no revocation, individually disabled users stay disabled', async () => {
    w.users.set('drv1', { ...(w.users.get('drv1') as UserData), status: 'disabled' })
    await setContractorStatus(w.deps, admin(), { contractorId: 'CS', status: 'active' })
    expect(w.contractors.get('CS')?.status).toBe('active')
    expect(w.revoked).toEqual([])
    expect(w.users.get('drv1')?.status).toBe('disabled')
    expect(w.audits.at(-1)?.action).toBe('contractor.activate')
  })

  it('re-suspending retries the revocation without a second audit entry; a partial failure is reported', async () => {
    w.failRevoke.add('drv1')
    await rejects(setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'suspended' }), 'internal')
    expect(w.contractors.get('C1')?.status).toBe('suspended')
    expect(w.revoked).toEqual(['sup1'])
    const audits = w.audits.length
    w.failRevoke.clear()
    await setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'suspended' })
    expect(w.revoked.sort()).toEqual(['drv1', 'sup1', 'sup1'])
    expect(w.audits.length).toBe(audits)
  })

  it('is admin only', async () => {
    for (const c of [sup1(), caller('officer', 'officer'), caller('sec', 'security'), caller('drv1', 'driver', 'C1')]) {
      await rejects(setContractorStatus(w.deps, c, { contractorId: 'C1', status: 'suspended' }), 'permission-denied')
    }
    expect(w.contractors.get('C1')?.status).toBe('active')
  })

  it('rejects missing and cross-tenant contractors and bad status', async () => {
    await rejects(setContractorStatus(w.deps, admin(), { contractorId: 'nope', status: 'suspended' }), 'not-found', 'contractor-not-found')
    await rejects(setContractorStatus(w.deps, admin(), { contractorId: 'CX', status: 'suspended' }), 'permission-denied', 'tenant-mismatch')
    await rejects(setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'deleted' }), 'invalid-argument')
  })

  it('a supervisor of the suspended contractor is locked out of vehicle functions at once', async () => {
    const { vehicleId } = await create()
    await setContractorStatus(w.deps, admin(), { contractorId: 'C1', status: 'suspended' })
    await rejects(setVehicleStatus(w.deps, sup1(), { vehicleId, status: 'suspended' }), 'permission-denied', 'caller-not-active')
  })
})

describe('setVehicleDrivers: penalties', () => {
  const penalise = (driverId: string, status: 'active' | 'revoked' = 'active') =>
    w.penalties.set(`pen_${driverId}`, {
      tenantId: 'T1', contractorId: 'C1', target: { driverId, vehicleId: null }, targetLabels: { driverName: null, plateNo: null }, typeId: 't', typeName: 'T',
      duration: { kind: 'permanent' }, issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: 0, reason: 'Reason', evidencePhotoPath: null,
      status, verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null },
    })

  it('refuses to newly assign a driver under an active penalty, but allows keeping or removing one', async () => {
    const { vehicleId } = await create(admin(), { driverIds: ['drv1'] })
    penalise('drv1')
    penalise('drv1b')
    await rejects(setVehicleDrivers(w.deps, sup1(), { vehicleId, driverIds: ['drv1', 'drv1b'] }), 'failed-precondition', 'penalty-blocked')
    await setVehicleDrivers(w.deps, sup1(), { vehicleId, driverIds: ['drv1'] }) // unchanged: fine
    await setVehicleDrivers(w.deps, sup1(), { vehicleId, driverIds: [] }) // removing: fine
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual([])
  })

  it('allows assigning once the penalty is revoked', async () => {
    const { vehicleId } = await create()
    penalise('drv1b', 'revoked')
    await setVehicleDrivers(w.deps, sup1(), { vehicleId, driverIds: ['drv1b'] })
    expect(w.vehicles.get(vehicleId)?.assignedDriverIds).toEqual(['drv1b'])
  })
})
