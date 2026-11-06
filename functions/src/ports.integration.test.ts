// Runs the real Firestore data port against the emulator (`npm run test:functions` starts it).
// Without FIRESTORE_EMULATOR_HOST the whole file is skipped, so a bare `vitest run` stays hermetic.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PassConflictError, PlateTakenError, type Deps } from './core.js'
import { newVehicleId } from './ids.js'
import { dataPort } from './ports.js'
import { bulkApprove, decidePass, revokePass } from './approvals.js'
import { dateKey } from './dates.js'
import { caller, makeWorld, NOW, admin } from './test-utils.js'
import type { AuditEntry, PassWrite, UserData, VehicleData } from './types.js'
import { createVehicle, updateVehicle } from './vehicles.js'
import { checkIn, denyEntry } from './gate.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const audit: AuditEntry = {
  tenantId: 'T1',
  action: 'test',
  actorUid: 'admin',
  actorRole: 'admin',
  targetType: 'vehicle',
  targetId: 'x',
  meta: {},
}
const vehicle = (plateKey: string, over: Partial<VehicleData> = {}): VehicleData => ({
  tenantId: 'T1',
  contractorId: 'C1',
  plateNo: plateKey,
  plateKey,
  type: 'Tipper',
  assignedDriverIds: [],
  status: 'active',
  ...over,
})

describe.skipIf(!emulator)('Firestore data port (emulator)', () => {
  const port = () => dataPort()
  let db: FirebaseFirestore.Firestore

  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })
  beforeEach(async () => {
    for (const c of ['vehicles', 'vehiclePlates', 'auditLog', 'users', 'drivers', 'contractors', 'passes', 'tenants', 'gateEvents']) {
      await db.recursiveDelete(db.collection(c))
    }
  })

  it('createVehicleTx: concurrent creates of one plate leave exactly one vehicle, one guard and one audit entry', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        port().createVehicleTx({ vehicleId: newVehicleId(), vehicle: vehicle('CAB1234'), actorUid: 'admin', audit }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PlateTakenError)
    expect((await db.collection('vehicles').get()).size).toBe(1)
    expect((await db.collection('vehiclePlates').get()).size).toBe(1)
    expect((await db.collection('auditLog').get()).size).toBe(1)
    const guard = await db.doc('vehiclePlates/T1_CAB1234').get()
    const created = (await db.collection('vehicles').get()).docs[0]
    expect(guard.data()).toEqual({ vehicleId: created?.id })
    expect(created?.data()).toMatchObject({ plateKey: 'CAB1234', createdBy: 'admin' })
  })

  it('updateVehicleTx moves the guard, rejects a taken plate and removes makeModel on null', async () => {
    const a = newVehicleId()
    const b = newVehicleId()
    await port().createVehicleTx({ vehicleId: a, vehicle: vehicle('AAA1111', { makeModel: 'Tata' }), actorUid: 'u', audit })
    await port().createVehicleTx({ vehicleId: b, vehicle: vehicle('BBB2222'), actorUid: 'u', audit })

    await port().updateVehicleTx({
      vehicleId: a,
      patch: { plateNo: 'CCC 3333', makeModel: null },
      plate: { plateNo: 'CCC 3333', plateKey: 'CCC3333' },
      audit,
    })
    expect((await db.doc('vehiclePlates/T1_AAA1111').get()).exists).toBe(false)
    expect((await db.doc('vehiclePlates/T1_CCC3333').get()).data()).toEqual({ vehicleId: a })
    const doc = (await db.doc(`vehicles/${a}`).get()).data()
    expect(doc).toMatchObject({ plateNo: 'CCC 3333', plateKey: 'CCC3333' })
    expect(doc).not.toHaveProperty('makeModel')

    await expect(
      port().updateVehicleTx({ vehicleId: b, patch: { plateNo: 'CCC3333' }, plate: { plateNo: 'CCC3333', plateKey: 'CCC3333' }, audit }),
    ).rejects.toBeInstanceOf(PlateTakenError)
    expect((await db.doc(`vehicles/${b}`).get()).data()).toMatchObject({ plateKey: 'BBB2222' })
    expect((await db.doc('vehiclePlates/T1_BBB2222').get()).exists).toBe(true)
  })

  it('updateVehicleTx: two vehicles racing for the same new plate, only one wins', async () => {
    const ids = [newVehicleId(), newVehicleId()]
    await port().createVehicleTx({ vehicleId: ids[0] as string, vehicle: vehicle('AAA1111'), actorUid: 'u', audit })
    await port().createVehicleTx({ vehicleId: ids[1] as string, vehicle: vehicle('BBB2222'), actorUid: 'u', audit })
    const results = await Promise.allSettled(
      ids.map((vehicleId) =>
        port().updateVehicleTx({ vehicleId, patch: { plateNo: 'ZZZ9999' }, plate: { plateNo: 'ZZZ9999', plateKey: 'ZZZ9999' }, audit }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await db.collection('vehiclePlates').get()).size).toBe(2)
  })

  it('core.createVehicle / updateVehicle work end to end on the real port', async () => {
    const w = makeWorld()
    const deps: Deps = { ...w.deps, data: { ...port(), getUser: w.deps.data.getUser, getContractor: w.deps.data.getContractor, getDrivers: w.deps.data.getDrivers }, newVehicleId }
    const { vehicleId } = await createVehicle(deps, admin(), { contractorId: 'C1', plateNo: 'wp lj-4821', type: 'Tipper', driverIds: ['drv1'] })
    expect(vehicleId).toMatch(/^veh_[a-z0-9]{10}$/)
    expect((await db.doc(`vehicles/${vehicleId}`).get()).data()).toMatchObject({ plateNo: 'WP LJ-4821', assignedDriverIds: ['drv1'] })
    await expect(createVehicle(deps, admin(), { contractorId: 'C1', plateNo: 'WPLJ4821', type: 'Tipper' })).rejects.toMatchObject({
      code: 'already-exists',
      details: { reason: 'plate-exists' },
    })
    await updateVehicle(deps, admin(), { vehicleId, plateNo: 'CAB-1234' })
    expect((await db.doc('vehiclePlates/T1_CAB1234').get()).data()).toEqual({ vehicleId })
  })

  it('createUserWithAudit writes the drivers doc; updateUserWithAudit patches it or backfills it', async () => {
    const user: UserData = {
      tenantId: 'T1', role: 'driver', contractorId: 'C1', name: 'D', email: null, phone: '94771234567', status: 'active', mustChangePassword: true,
    }
    const driver = { tenantId: 'T1', contractorId: 'C1', name: 'D', phone: '94771234567', status: 'active' as const }
    await port().createUserWithAudit('d1', user, 'admin', audit, driver)
    expect((await db.doc('drivers/d1').get()).data()).toMatchObject({ ...driver })

    await port().updateUserWithAudit('d1', { name: 'E' }, audit, { patch: { name: 'E', licenseNo: 'L1' } })
    expect((await db.doc('drivers/d1').get()).data()).toMatchObject({ name: 'E', licenseNo: 'L1' })

    await db.doc('users/legacy').set({ ...user, name: 'Old' })
    await port().updateUserWithAudit('legacy', { name: 'New' }, audit, { patch: { name: 'New' }, backfill: { ...driver, name: 'Old' } })
    expect((await db.doc('drivers/legacy').get()).data()).toMatchObject({ ...driver, name: 'New' })
  })

  it('listUserIdsByContractor and getDrivers', async () => {
    await db.doc('users/a').set({ tenantId: 'T1', contractorId: 'C1' })
    await db.doc('users/b').set({ tenantId: 'T1', contractorId: 'C2' })
    await db.doc('users/c').set({ tenantId: 'T2', contractorId: 'C1' })
    await db.doc('drivers/a').set({ tenantId: 'T1', contractorId: 'C1', name: 'A', phone: '1', status: 'active' })
    expect(await port().listUserIdsByContractor('T1', 'C1')).toEqual(['a'])
    expect([...(await port().getDrivers(['a', 'zzz'])).keys()]).toEqual(['a'])
    expect((await port().getDrivers([])).size).toBe(0)
  })

  const passWrite = (attempt: number, over: Partial<PassWrite> = {}): PassWrite => {
    const file = (n: string) => ({ path: `p/${attempt}/${n}`, size: 20000, contentType: 'image/jpeg' })
    return {
      tenantId: 'T1', contractorId: 'C1', vehicleId: 'veh_aaaaaaaaaa', plateNo: 'CAB-1', vehicleType: 'Tipper', dateKey: '20260310',
      driverId: 'd1', driverName: 'D', attempt, checklist: [{ id: 'x', label: 'X', answer: 'yes' }],
      evidence: { gps: file('gps.jpg'), dashcam: file('dashcam.jpg'), extra: [] },
      captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } }, ...over,
    }
  }
  const passAudit = { ...audit, targetType: 'pass' as const, targetId: 'veh_aaaaaaaaaa_20260310' }

  it('submitPassTx: concurrent first submissions leave one pass and one audit entry', async () => {
    const id = 'veh_aaaaaaaaaa_20260310'
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => port().submitPassTx({ passId: id, pass: passWrite(1), audit: passAudit })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PassConflictError)
    expect((await db.collection('auditLog').get()).size).toBe(1)
    const pass = await port().getPass(id)
    expect(pass).toMatchObject({ status: 'submitted', attempt: 1 })
    expect(typeof pass?.submittedAt).toBe('number')
  })

  it('submitPassTx: resubmitting a rejected pass moves the rejection into rejectionHistory', async () => {
    const id = 'veh_aaaaaaaaaa_20260310'
    await port().submitPassTx({ passId: id, pass: passWrite(1), audit: passAudit })
    await expect(port().submitPassTx({ passId: id, pass: passWrite(2), audit: passAudit })).rejects.toMatchObject({ kind: 'exists' })

    await db.doc(`passes/${id}`).update({
      status: 'rejected', rejection: { reason: 'Blurry', byUid: 's1', byRole: 'supervisor', at: new Date() },
    })
    const stored = await port().getPass(id)
    expect(typeof stored?.rejection?.at).toBe('number')
    await expect(port().submitPassTx({ passId: id, pass: passWrite(2, { driverId: 'other' }), audit: passAudit })).rejects.toMatchObject({ kind: 'driver' })
    await expect(port().submitPassTx({ passId: id, pass: passWrite(3), audit: passAudit })).rejects.toMatchObject({ kind: 'attempt' })

    await port().submitPassTx({ passId: id, pass: passWrite(2), audit: passAudit })
    const raw = (await db.doc(`passes/${id}`).get()).data()
    expect(raw).toMatchObject({ status: 'submitted', attempt: 2 })
    expect(raw).not.toHaveProperty('rejection')
    expect(raw?.rejectionHistory).toHaveLength(1)
    expect(raw?.rejectionHistory[0]).toMatchObject({ attempt: 1, reason: 'Blurry', evidence: { gps: { path: 'p/1/gps.jpg' } } })
    expect(raw?.evidence.gps.path).toBe('p/2/gps.jpg')
  })

  describe('decidePassTx on the real port', () => {
    const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
    const VID = 'veh_aaaaaaaaaa'
    const ID = `${VID}_${DAY}`
    const sup = () => caller('sup1', 'supervisor', 'C1')
    const officer = () => caller('officer', 'officer')
    // The real port for pass data, the fake world for the caller checks and the clock.
    const deps = (): Deps => {
      const w = makeWorld()
      return { ...w.deps, data: { ...port(), getUser: w.deps.data.getUser, getContractor: w.deps.data.getContractor, getTenant: w.deps.data.getTenant } }
    }
    const seedPass = async (over: Record<string, unknown> = {}) => {
      await db.doc(`vehicles/${VID}`).set({ tenantId: 'T1', contractorId: 'C1', status: 'active', assignedDriverIds: ['drv1'] })
      await db.doc('contractors/C1').set({ tenantId: 'T1', status: 'active' })
      await db.doc('users/drv1').set({ tenantId: 'T1', role: 'driver', contractorId: 'C1', status: 'active', name: 'Dan' })
      await db.doc(`passes/${ID}`).set({
        tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'CAB-1', dateKey: DAY, driverId: 'drv1', driverName: 'Dan',
        status: 'submitted', attempt: 1, checklist: [{ id: 'x', label: 'X', answer: 'yes' }],
        evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
        ...over,
      })
    }
    const body = { passId: ID, action: 'approve', expectedStatus: 'submitted', expectedAttempt: 1 }

    it('two simultaneous approvals: exactly one succeeds, one history entry, one audit entry', async () => {
      await seedPass()
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => decidePass(deps(), sup(), body)))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ details: { reason: 'pass-changed' } })
      const raw = (await db.doc(`passes/${ID}`).get()).data()
      expect(raw).toMatchObject({ status: 'supervisor_approved', supervisor: { uid: 'sup1' } })
      expect(raw?.history).toHaveLength(1)
      expect(raw?.supervisor.at.toMillis()).toBe(NOW * 1000) // stored as a Timestamp
      expect((await db.collection('auditLog').get()).size).toBe(1)
    })

    it('approve then officer approve, then revoke, then resubmit keeps the history', async () => {
      await seedPass()
      await decidePass(deps(), sup(), body)
      await decidePass(deps(), officer(), { ...body, expectedStatus: 'supervisor_approved' })
      await revokePass(deps(), admin(), { passId: ID, reasonCode: 'photo_not_fresh' })
      const stored = await port().getPass(ID)
      expect(stored).toMatchObject({ status: 'rejected', rejection: { stage: 'revoked', byRole: 'admin' } })
      expect(typeof stored?.rejection?.at).toBe('number')
      expect(stored?.history?.map((h) => h.action)).toEqual(['approve', 'approve', 'revoke'])

      await port().submitPassTx({
        passId: ID, audit: { ...audit, targetType: 'pass', targetId: ID },
        pass: {
          tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'CAB-1', vehicleType: 'Tipper', dateKey: DAY, driverId: 'drv1',
          driverName: 'Dan', attempt: 2, checklist: [{ id: 'x', label: 'X', answer: 'yes' }],
          evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
          captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
        },
      })
      const raw = (await db.doc(`passes/${ID}`).get()).data()
      expect(raw).toMatchObject({ status: 'submitted', attempt: 2 })
      expect(raw).not.toHaveProperty('supervisor')
      expect(raw).not.toHaveProperty('officer')
      expect(raw?.history).toHaveLength(3)
      expect(raw?.rejectionHistory).toHaveLength(1)
    })

    it('bulkApprove approves clean passes and refuses ones with a "No" on the real port', async () => {
      await seedPass()
      await db.doc(`passes/${VID}2_${DAY}`).set({
        tenantId: 'T1', contractorId: 'C1', vehicleId: VID, dateKey: DAY, driverId: 'drv1', status: 'submitted', attempt: 1,
        checklist: [{ id: 'x', label: 'X', answer: 'no', note: 'broken' }],
      })
      const { results } = await bulkApprove(deps(), sup(), {
        items: [{ passId: ID, expectedAttempt: 1 }, { passId: `${VID}2_${DAY}`, expectedAttempt: 1 }],
      })
      expect(results).toEqual([{ passId: ID, ok: true }, { passId: `${VID}2_${DAY}`, ok: false, error: 'has_issues' }])
    })

    it('checkIn: ten guards at once, exactly one wins; the stored check-in reads back in milliseconds', async () => {
      await seedPass({ status: 'officer_approved' })
      const sec = () => caller('sec', 'security')
      const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
      const results = await Promise.allSettled(ids.map((requestId) => checkIn(deps(), sec(), { passId: ID, expectedAttempt: 1, gateId: 'main', requestId })))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'already-exists', details: { reason: 'pass-checked-in' } })
      const raw = (await db.doc(`passes/${ID}`).get()).data()
      expect(raw).toMatchObject({ status: 'checked_in', checkIn: { uid: 'sec', gateId: 'main', gateName: 'Main Gate' } })
      expect(raw?.checkIn.at.toMillis()).toBe(NOW * 1000)
      expect(raw?.history).toHaveLength(1)
      expect((await db.collection('auditLog').get()).size).toBe(1)
      const winner = raw?.checkIn.requestId as string
      // Replaying the winner's request is a success with the same time, and writes nothing.
      expect(await checkIn(deps(), sec(), { passId: ID, expectedAttempt: 1, gateId: 'main', requestId: winner })).toEqual({ passId: ID, status: 'checked_in', at: NOW * 1000 })
      expect((await port().getPass(ID))?.checkIn?.at).toBe(NOW * 1000)
      expect((await db.collection('auditLog').get()).size).toBe(1)
    })

    it('denyEntry writes gateEvents/den_{requestId} once and leaves the pass alone', async () => {
      await seedPass({ status: 'officer_approved', plateNo: 'CAB-1' })
      await db.doc(`vehicles/${VID}`).update({ plateNo: 'CAB-1' })
      const before = (await db.doc(`passes/${ID}`).get()).data()
      const requestId = '33333333-3333-4333-8333-333333333333'
      const body = { vehicleId: VID, reasonCode: 'vehicle_condition', gateId: 'main', requestId }
      const first = await denyEntry(deps(), caller('sec', 'security'), body)
      expect(await denyEntry(deps(), caller('sec', 'security'), body)).toEqual(first)
      const event = (await db.doc(`gateEvents/den_${requestId}`).get()).data()
      expect(event).toMatchObject({ tenantId: 'T1', type: 'denied', plateNo: 'CAB-1', passId: ID, passStatus: 'officer_approved', byUid: 'sec' })
      expect(event?.at.toMillis()).toBe(NOW * 1000)
      expect((await db.collection('gateEvents').get()).size).toBe(1)
      expect((await db.collection('auditLog').get()).size).toBe(1)
      expect((await db.doc(`passes/${ID}`).get()).data()).toEqual(before)
    })

    it('refuses to approve when the driver is disabled, naming the driver', async () => {
      await seedPass()
      await db.doc('users/drv1').update({ status: 'disabled' })
      await expect(decidePass(deps(), sup(), body)).rejects.toMatchObject({ details: { reason: 'driver-inactive' } })
    })
  })

  it('updateTenantSettingsWithAudit merges settings and keeps other tenant fields', async () => {
    await db.doc('tenants/T1').set({ name: 'Demo', timezone: 'Asia/Colombo' })
    await port().updateTenantSettingsWithAudit('T1', { passSettings: { requireLocation: true, maxExtraPhotos: 1 } }, { ...audit, targetType: 'tenant' })
    expect((await db.doc('tenants/T1').get()).data()).toMatchObject({ name: 'Demo', timezone: 'Asia/Colombo', passSettings: { requireLocation: true, maxExtraPhotos: 1 } })
  })

  describe('report queries', () => {
    const base = (id: string, over: Record<string, unknown>) =>
      db.doc(`passes/${id}`).set({
        tenantId: 'T1', contractorId: 'C1', vehicleId: 'veh_a', plateNo: 'A 1', vehicleType: 'Tipper', dateKey: '20260310', driverId: 'd1',
        driverName: 'Dan', status: 'submitted', attempt: 1, submittedAt: Timestamp.fromMillis(1000),
        checklist: [{ id: 'x', label: 'x', answer: 'yes' }],
        evidence: { gps: { path: 'tenants/T1/secret.jpg', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'p', size: 1, contentType: 'image/jpeg' }, extra: [] },
        captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
        ...over,
      })

    it('counts and lists by dateKey range, status and one equality filter, without evidence', async () => {
      await base('a', {})
      await base('b', { dateKey: '20260311', status: 'checked_in', vehicleId: 'veh_b' })
      await base('c', { dateKey: '20260312', contractorId: 'C2' })
      await base('d', { tenantId: 'T2' })
      const q = { kind: 'dateKey' as const, tenantId: 'T1', fromKey: '20260310', toKey: '20260311' }
      expect(await port().countPasses(q)).toBe(2)
      expect(await port().countPasses({ ...q, fromKey: '20260311', statuses: ['checked_in', 'rejected'] })).toBe(1)
      expect(await port().countPasses({ ...q, fromKey: '20260310', toKey: '20260310', statuses: ['submitted'] })).toBe(1)
      const listed = await port().listPasses({ ...q, toKey: '20260312', contractorId: 'C1', vehicleId: 'veh_a' }, 100)
      expect(listed.map((p) => p.id)).toEqual(['a'])
      expect(JSON.stringify(listed)).not.toContain('secret')
      expect(listed[0]?.submittedAt).toBe(1000)
    })

    it('lists check-ins and denials by time, half open', async () => {
      const at = (ms: number) => ({ checkIn: { uid: 's', name: 'G', at: Timestamp.fromMillis(ms), gateId: 'main', gateName: 'Main', requestId: 'r' } })
      await base('in1', at(1000))
      await base('in2', at(2000))
      await base('none', {})
      const event = (id: string, ms: number) =>
        db.doc(`gateEvents/${id}`).set({ tenantId: 'T1', type: 'denied', vehicleId: 'v', plateNo: 'A', contractorId: 'C1', reasonCode: 'other', gateId: 'main', gateName: 'Main', byUid: 's', byName: 'G', at: Timestamp.fromMillis(ms), requestId: id })
      await event('den_1', 1500)
      await event('den_2', 2000)
      const q = { tenantId: 'T1', startMs: 1000, endMs: 2000 }
      const passes = await port().listPasses({ kind: 'checkIn', ...q }, 10)
      expect(passes.map((p) => [p.id, p.checkIn?.at])).toEqual([['in1', 1000]])
      expect(await port().countPasses({ kind: 'checkIn', ...q })).toBe(1)
      expect((await port().listGateEvents(q, 10)).map((e) => [e.id, e.at])).toEqual([['den_1', 1500]])
      expect(await port().countGateEvents(q)).toBe(1)
    })

    it('lists contractor names of the tenant only', async () => {
      await db.doc('contractors/C1').set({ tenantId: 'T1', name: 'Alpha', status: 'active' })
      await db.doc('contractors/CX').set({ tenantId: 'T2', name: 'Other', status: 'active' })
      expect([...(await port().listContractorNames('T1'))]).toEqual([['C1', 'Alpha']])
    })
  })
})
