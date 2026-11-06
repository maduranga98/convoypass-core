// Runs the real Firestore adapter for inspections (record, supersede, withdraw, trigger-side invalidation, live check)
// against the emulator. Without FIRESTORE_EMULATOR_HOST the whole file is skipped.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkEligibility } from './checkEligibility.js'
import type { Deps } from './core.js'
import { invalidateForDriverExpiry, invalidateForPenalty } from './inspectionInvalidation.js'
import { recordInspection, withdrawClearance } from './inspections.js'
import { dataPort, toPenalty } from './ports.js'
import { caller, makeWorld, NOW, rejects, userDoc } from './test-utils.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const NOW_MS = NOW * 1000
const V1 = 'veh_aaaaaaaaaa'
const V2 = 'veh_bbbbbbbbbb'

describe.skipIf(!emulator)('inspections on the Firestore emulator', () => {
  let db: FirebaseFirestore.Firestore
  let deps: Deps
  const safety = () => caller('safe1', 'safety')
  let n = 0
  const record = (vehicleId = V1, over: Record<string, unknown> = {}) =>
    recordInspection(deps, safety(), { inspectionId: `insp_${String(++n).padStart(10, 'a')}`, vehicleId, result: 'approved', notes: '', ...over })
  const get = async (path: string) => (await db.doc(path).get()).data() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })

  beforeEach(async () => {
    for (const c of ['inspections', 'penalties', 'auditLog', 'users', 'drivers', 'vehicles', 'contractors', 'tenants']) await db.recursiveDelete(db.collection(c))
    deps = { ...makeWorld().deps, data: dataPort() }
    await db.doc('tenants/T1').set({ timezone: 'Asia/Colombo' })
    await db.doc('contractors/C1').set({ tenantId: 'T1', status: 'active' })
    await db.doc('users/safe1').set(userDoc({ role: 'safety', contractorId: null, name: 'Sam Safety', email: 'sf@x.com', phone: null }))
    await db.doc('users/sec').set(userDoc({ role: 'security', contractorId: null, name: 'Sam', email: 'sec@x.com', phone: null }))
    const base = { tenantId: 'T1', contractorId: 'C1', type: 'Tipper', status: 'active' }
    await db.doc(`vehicles/${V1}`).set({ ...base, plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', assignedDriverIds: ['drv1'] })
    await db.doc(`vehicles/${V2}`).set({ ...base, plateNo: 'WP LJ-4822', plateKey: 'WPLJ4822', assignedDriverIds: ['drv1', 'drv2'] })
    await db.doc('drivers/drv1').set({ tenantId: 'T1', contractorId: 'C1', name: 'Dan', phone: null, status: 'active' })
  })

  it('records, supersedes and keeps the vehicle copy in step, atomically', async () => {
    const a = await record()
    expect(await get(`vehicles/${V1}`)).toMatchObject({ clearance: { status: 'cleared', inspectionId: a.inspectionId, reason: null, at: NOW_MS } })
    const stored = await get(`inspections/${a.inspectionId}`)
    expect(stored).toMatchObject({ tenantId: 'T1', vehicleId: V1, contractorId: 'C1', plateNo: 'WP LJ-4821', status: 'active', result: 'approved' })
    expect(stored.inspectedAt.toMillis()).toBe(NOW_MS)
    expect(stored.createdAt).toBeTruthy()

    const b = await record(V1, { result: 'rejected', notes: 'Tyres worn' })
    expect(await get(`inspections/${a.inspectionId}`)).toMatchObject({ status: 'superseded', supersededBy: b.inspectionId })
    expect(await get(`vehicles/${V1}`)).toMatchObject({ clearance: { status: 'rejected', inspectionId: b.inspectionId } })
    expect((await db.collection('inspections').get()).size).toBe(2)
    expect((await db.collection('auditLog').where('action', '==', 'inspection.record').get()).size).toBe(2)
  })

  it('a retry of the same call writes nothing more', async () => {
    const id = 'insp_retryaaaaa'
    const call = () => recordInspection(deps, safety(), { inspectionId: id, vehicleId: V1, result: 'approved', notes: '' })
    expect(await call()).toMatchObject({ created: true })
    expect(await call()).toMatchObject({ created: false, clearance: 'cleared' })
    expect((await db.collection('inspections').get()).size).toBe(1)
    expect((await db.collection('auditLog').get()).size).toBe(1)
  })

  it('concurrent inspections leave exactly one active record', async () => {
    await record()
    await Promise.all([record(), record(), record()])
    const all = (await db.collection('inspections').get()).docs.map((d) => d.get('status') as string)
    expect(all.filter((s) => s === 'active')).toHaveLength(1)
    expect(all.filter((s) => s === 'superseded')).toHaveLength(3)
  })

  it('a penalty cancels the approval, the live check says why, a new approval restores it', async () => {
    const a = await record()
    const security = caller('sec', 'security')
    expect(await checkEligibility(deps, security, { vehicleId: V1 })).toMatchObject({ eligible: true, inspection: { cleared: true } })

    const penaltyDoc = {
      tenantId: 'T1', contractorId: 'C1', target: { driverId: null, vehicleId: V1 }, targetLabels: { driverName: null, plateNo: 'X' }, typeId: 'pty_1', typeName: 'Damage',
      duration: { kind: 'permanent' }, issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: new Date(NOW_MS + 1000), reason: 'Reason', evidencePhotoPath: null, status: 'active',
      verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null },
    }
    await db.doc('penalties/pen_aaaaaaaaaa').set(penaltyDoc)
    const stored = (await db.doc('penalties/pen_aaaaaaaaaa').get()).data() as Record<string, unknown>
    expect(await invalidateForPenalty(deps.data, 'pen_aaaaaaaaaa', toPenalty(stored), NOW_MS + 2000)).toEqual({ vehicles: 1, invalidated: 1 })
    expect(await get(`inspections/${a.inspectionId}`)).toMatchObject({ status: 'invalidated', invalidatedReason: 'penalty_issued', invalidationSource: 'pen_aaaaaaaaaa' })
    expect(await get(`vehicles/${V1}`)).toMatchObject({ clearance: { status: 'needs_reinspection', reason: 'penalty_issued', inspectionId: a.inspectionId } })
    expect(await checkEligibility(deps, security, { vehicleId: V1 })).toMatchObject({ eligible: false, inspection: { status: 'needs_reinspection', reason: 'penalty_issued' } })
    // Second delivery of the trigger: nothing changes.
    expect(await invalidateForPenalty(deps.data, 'pen_aaaaaaaaaa', toPenalty(stored), NOW_MS + 3000)).toMatchObject({ invalidated: 0 })
    expect((await db.collection('auditLog').where('action', '==', 'inspection.invalidate').get()).size).toBe(1)

    await db.doc('penalties/pen_aaaaaaaaaa').update({ status: 'revoked' })
    const b = await record()
    expect(await get(`inspections/${a.inspectionId}`)).toMatchObject({ status: 'superseded', supersededBy: b.inspectionId, invalidatedReason: 'penalty_issued' })
    expect(await checkEligibility(deps, security, { vehicleId: V1 })).toMatchObject({ eligible: true })
  })

  it('a driver penalty and a lapsed licence reach every vehicle the driver is assigned to', async () => {
    await record(V1)
    await record(V2)
    await db.doc('drivers/drv1').update({ eligibilityStatus: 'expired' })
    expect(await invalidateForDriverExpiry(deps.data, 'T1', 'drv1', NOW_MS + 1, NOW_MS + 1)).toEqual({ vehicles: 2, invalidated: 2 })
    expect((await get(`vehicles/${V2}`)).clearance).toMatchObject({ status: 'needs_reinspection', reason: 'document_expired' })
  })

  it('withdraws a clearance manually, once', async () => {
    const a = await record()
    await withdrawClearance(deps, safety(), { vehicleId: V1, note: 'Cracked windscreen' })
    expect(await get(`inspections/${a.inspectionId}`)).toMatchObject({ status: 'invalidated', invalidatedReason: 'manual', invalidationNote: 'Cracked windscreen', invalidationSource: 'safe1' })
    await rejects(withdrawClearance(deps, safety(), { vehicleId: V1, note: 'again' }), 'failed-precondition', 'not-cleared')
  })

  it('never touches another tenant’s vehicle', async () => {
    await db.doc('vehicles/veh_foreign').set({ tenantId: 'T2', contractorId: 'CX', plateNo: 'X', plateKey: 'X', type: 'Tipper', assignedDriverIds: [], status: 'active' })
    await rejects(record('veh_foreign'), 'not-found', 'vehicle-not-found')
    expect((await db.collection('inspections').get()).size).toBe(0)
  })
})
