import { beforeEach, describe, expect, it } from 'vitest'
import { checkEligibility } from './checkEligibility.js'
import { recordInspection, withdrawClearance } from './inspections.js'
import { NOW, admin, caller, makeWorld, rejects, sup1, type World } from './test-utils.js'

const VID = 'veh_aaaaaaaaaa'
const NOW_MS = NOW * 1000
const safety = () => caller('safe1', 'safety')

let w: World
beforeEach(() => {
  w = makeWorld()
  w.vehicles.set(VID, { tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
})

let n = 0
const newId = () => `insp_${String(++n).padStart(10, 'a')}`
const record = (over: Record<string, unknown> = {}, c = safety()) =>
  recordInspection(w.deps, c, { inspectionId: newId(), vehicleId: VID, result: 'approved', notes: '', ...over })

describe('recordInspection', () => {
  it('approves a vehicle: creates the record, sets the clearance copy and audits it', async () => {
    const res = await record({ notes: 'Brakes and lights fine' })
    expect(res).toMatchObject({ created: true, clearance: 'cleared' })
    expect(w.inspections.get(res.inspectionId)).toMatchObject({
      tenantId: 'T1', vehicleId: VID, contractorId: 'C1', plateNo: 'WP LJ-4821', inspectedBy: { uid: 'safe1' },
      inspectedAt: NOW_MS, result: 'approved', status: 'active', invalidatedReason: null, invalidatedAt: null,
    })
    expect(w.vehicles.get(VID)?.clearance).toEqual({ status: 'cleared', inspectionId: res.inspectionId, reason: null, at: NOW_MS })
    expect(w.audits.at(-1)).toMatchObject({ action: 'inspection.record', targetType: 'inspection', targetId: res.inspectionId, meta: { result: 'approved', hasNotes: true } })
  })

  it('never puts the notes in the audit entry', async () => {
    await record({ notes: 'private remark about the driver' })
    expect(JSON.stringify(w.audits)).not.toContain('private remark')
  })

  it('a new inspection supersedes the previous one, which stays in the history', async () => {
    const first = await record()
    const second = await record({ result: 'rejected', notes: 'Tyres worn' })
    expect(second.clearance).toBe('rejected')
    expect(w.inspections.get(first.inspectionId)).toMatchObject({ status: 'superseded', supersededBy: second.inspectionId })
    expect(w.inspections.get(second.inspectionId)?.status).toBe('active')
    expect(w.vehicles.get(VID)?.clearance).toMatchObject({ status: 'rejected', inspectionId: second.inspectionId })
    expect(w.inspections.size).toBe(2)
  })

  it('an approval after an invalidation supersedes the invalidated record and restores clearance', async () => {
    const first = await record()
    w.inspections.set(first.inspectionId, { ...w.inspections.get(first.inspectionId)!, status: 'invalidated', invalidatedReason: 'penalty_issued', invalidatedAt: NOW_MS })
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, clearance: { status: 'needs_reinspection', inspectionId: first.inspectionId, reason: 'penalty_issued', at: NOW_MS } })
    const second = await record()
    expect(w.inspections.get(first.inspectionId)?.status).toBe('superseded')
    expect(w.vehicles.get(VID)?.clearance?.status).toBe('cleared')
    expect(second.clearance).toBe('cleared')
  })

  it('a rejection needs a note; an approval does not', async () => {
    await rejects(record({ result: 'rejected', notes: '  ' }), 'invalid-argument', 'notes-required')
    await rejects(record({ result: 'rejected', notes: 'bad' }), 'invalid-argument', 'notes-required')
    expect(w.inspections.size).toBe(0)
    await expect(record({ result: 'approved', notes: '' })).resolves.toMatchObject({ created: true })
  })

  it('only the Safety Officer may record: admin, supervisor, officer, security and drivers are refused', async () => {
    for (const c of [admin(), sup1(), caller('officer', 'officer'), caller('sec', 'security'), caller('drv1', 'driver', 'C1')]) {
      await rejects(record({}, c), 'permission-denied', 'forbidden')
    }
    expect(w.inspections.size).toBe(0)
  })

  it('refuses another tenant’s vehicle and a missing one as "not found"', async () => {
    w.vehicles.set('veh_other', { ...w.vehicles.get(VID)!, tenantId: 'T2', contractorId: 'CX' })
    await rejects(record({ vehicleId: 'veh_other' }), 'not-found', 'vehicle-not-found')
    await rejects(record({ vehicleId: 'veh_missing' }), 'not-found', 'vehicle-not-found')
  })

  it('refuses a malformed id, result or oversized notes', async () => {
    await rejects(record({ inspectionId: 'bad' }), 'invalid-argument', 'invalid-input')
    await rejects(record({ result: 'maybe' }), 'invalid-argument', 'invalid-input')
    await rejects(record({ notes: 'x'.repeat(1001) }), 'invalid-argument', 'invalid-input')
  })

  it('is idempotent for the same id and officer; a different officer or vehicle on that id is a conflict', async () => {
    const id = newId()
    const call = (c = safety(), over: Record<string, unknown> = {}) => recordInspection(w.deps, c, { inspectionId: id, vehicleId: VID, result: 'approved', notes: '', ...over })
    expect(await call()).toMatchObject({ created: true })
    expect(await call()).toMatchObject({ created: false, clearance: 'cleared' })
    expect(w.inspections.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'inspection.record')).toHaveLength(1)
    w.users.set('safe2', { ...w.users.get('safe1')! })
    await rejects(call(caller('safe2', 'safety')), 'already-exists', 'request-conflict')
  })

  it('a suspended caller cannot record', async () => {
    w.users.set('safe1', { ...w.users.get('safe1')!, status: 'disabled' })
    await rejects(record(), 'permission-denied', 'caller-not-active')
  })
})

describe('withdrawClearance', () => {
  it('cancels a standing approval with reason manual and the officer’s note', async () => {
    const { inspectionId } = await record()
    await withdrawClearance(w.deps, safety(), { vehicleId: VID, note: 'Cracked windscreen seen on the road' })
    expect(w.inspections.get(inspectionId)).toMatchObject({
      status: 'invalidated', invalidatedReason: 'manual', invalidatedAt: NOW_MS, invalidationSource: 'safe1', invalidationNote: 'Cracked windscreen seen on the road',
    })
    expect(w.vehicles.get(VID)?.clearance).toMatchObject({ status: 'needs_reinspection', reason: 'manual' })
    expect(w.audits.at(-1)).toMatchObject({ action: 'inspection.withdraw', targetId: inspectionId })
    expect(JSON.stringify(w.audits)).not.toContain('windscreen')
  })

  it('refuses when nothing is cleared (never inspected, rejected, already withdrawn)', async () => {
    await rejects(withdrawClearance(w.deps, safety(), { vehicleId: VID, note: 'x' }), 'failed-precondition', 'not-cleared')
    await record({ result: 'rejected', notes: 'Tyres worn' })
    await rejects(withdrawClearance(w.deps, safety(), { vehicleId: VID, note: 'x' }), 'failed-precondition', 'not-cleared')
    await record()
    await withdrawClearance(w.deps, safety(), { vehicleId: VID, note: 'x' })
    await rejects(withdrawClearance(w.deps, safety(), { vehicleId: VID, note: 'again' }), 'failed-precondition', 'not-cleared')
  })

  it('is for the Safety Officer only and needs a note', async () => {
    await record()
    await rejects(withdrawClearance(w.deps, admin(), { vehicleId: VID, note: 'x' }), 'permission-denied', 'forbidden')
    await rejects(withdrawClearance(w.deps, safety(), { vehicleId: VID, note: ' ' }), 'invalid-argument', 'invalid-input')
  })
})

describe('checkEligibility with inspections', () => {
  const check = (ref: Record<string, unknown> = { vehicleId: VID, driverId: 'drv1' }, c = caller('sec', 'security')) => checkEligibility(w.deps, c, ref)

  it('a vehicle that was never inspected is not eligible, though documents and penalties pass', async () => {
    expect(await check()).toMatchObject({ status: 'valid', blocked: false, eligible: false, inspection: { status: 'never_inspected', cleared: false, reason: null, at: null } })
  })

  it('an approved inspection clears it; the three layers must all pass', async () => {
    await record()
    expect(await check()).toMatchObject({ eligible: true, inspection: { status: 'cleared', cleared: true, at: NOW_MS } })
    // Layer 2: an active penalty.
    w.penalties.set('pen_x', {
      tenantId: 'T1', contractorId: 'C1', target: { driverId: null, vehicleId: VID }, targetLabels: { driverName: null, plateNo: 'x' }, typeId: 't', typeName: 'T',
      duration: { kind: 'permanent' }, issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: NOW_MS - 1, reason: 'r', evidencePhotoPath: null, status: 'active',
      verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null },
    })
    expect(await check()).toMatchObject({ blocked: true, eligible: false, inspection: { cleared: true } })
    w.penalties.clear()
    // Layer 1: an expired document.
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, insuranceExpiry: '2023-11-01' })
    expect(await check()).toMatchObject({ status: 'expired', eligible: false, inspection: { cleared: true } })
  })

  it('reports why a vehicle needs re-inspection, and a rejection as rejected', async () => {
    const { inspectionId } = await record()
    w.inspections.set(inspectionId, { ...w.inspections.get(inspectionId)!, status: 'invalidated', invalidatedReason: 'document_expired', invalidatedAt: NOW_MS + 5 })
    expect(await check()).toMatchObject({ eligible: false, inspection: { status: 'needs_reinspection', cleared: false, reason: 'document_expired', at: NOW_MS + 5 } })
    await record({ result: 'rejected', notes: 'Tyres worn' })
    expect(await check()).toMatchObject({ eligible: false, inspection: { status: 'rejected', cleared: false } })
  })

  it('trusts the inspection record, not the copy on the vehicle', async () => {
    const { inspectionId } = await record()
    w.inspections.set(inspectionId, { ...w.inspections.get(inspectionId)!, status: 'invalidated', invalidatedReason: 'manual', invalidatedAt: NOW_MS })
    // The copy still says "cleared" (drift): the check must not.
    expect(w.vehicles.get(VID)?.clearance?.status).toBe('cleared')
    expect(await check()).toMatchObject({ inspection: { cleared: false } })
  })

  it('ignores a record that belongs to another tenant', async () => {
    const { inspectionId } = await record()
    w.inspections.set(inspectionId, { ...w.inspections.get(inspectionId)!, tenantId: 'T2' })
    expect(await check()).toMatchObject({ inspection: { status: 'never_inspected' } })
  })

  it('a driver-only check has no inspection; eligible reflects documents and penalties', async () => {
    expect(await check({ driverId: 'drv1' })).toMatchObject({ inspection: null, eligible: true })
  })

  it('does not expose the officer, notes or ids of the record', async () => {
    await record({ notes: 'secret note' })
    const json = JSON.stringify(await check())
    expect(json).not.toContain('secret note')
    expect(json).not.toContain('safe1')
    expect(json).not.toContain('insp_')
  })
})
