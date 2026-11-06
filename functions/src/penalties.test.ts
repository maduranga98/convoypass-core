import { beforeEach, describe, expect, it } from 'vitest'
import { createPenaltyType, deletePenaltyType, issuePenalty, penaltyEvidencePath, revokePenalty, updatePenaltyType, verifyPenalty } from './penalties.js'
import { NOW, admin, caller, makeWorld, rejects, sup1, sup2, type World } from './test-utils.js'
import type { PenaltyData } from './types.js'

const safety = () => caller('safe1', 'safety')
const PID = 'pen_aaaaaaaaaa'
const PID2 = 'pen_bbbbbbbbbb'
const VID = 'veh_aaaaaaaaaa'
const NOW_MS = NOW * 1000

let w: World
let typeId: string
beforeEach(async () => {
  w = makeWorld()
  w.vehicles.set(VID, { tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
  w.vehicles.set('veh_other2', { tenantId: 'T1', contractorId: 'C2', plateNo: 'CAB-1', plateKey: 'CAB1', type: 'Tipper', assignedDriverIds: [], status: 'active' })
  w.drivers.set('drv1', { ...(w.drivers.get('drv1') as object), name: 'Dan Driver' } as never)
  ;({ typeId } = await createPenaltyType(w.deps, admin(), { name: 'Safety Violation' }))
})

const issue = (c = safety(), over: Record<string, unknown> = {}) =>
  issuePenalty(w.deps, c, { penaltyId: PID, vehicleId: VID, typeId, duration: { kind: 'permanent' }, reason: 'Driving without a helmet', ...over })
const stored = (id = PID) => w.penalties.get(id) as PenaltyData

describe('penalty types', () => {
  it('admin creates, renames and removes; names are squashed and unique ignoring case; audited', async () => {
    const { typeId: id } = await createPenaltyType(w.deps, admin(), { name: '  Late   Return ' })
    expect(w.penaltyTypes.get(id)).toMatchObject({ tenantId: 'T1', name: 'Late Return', nameKey: 'late return', createdBy: 'admin' })
    await rejects(createPenaltyType(w.deps, admin(), { name: 'late return' }), 'already-exists', 'penalty-type-exists')
    await updatePenaltyType(w.deps, admin(), { typeId: id, name: 'Late Returns' })
    expect(w.penaltyTypes.get(id)?.name).toBe('Late Returns')
    await rejects(updatePenaltyType(w.deps, admin(), { typeId: id, name: 'safety violation' }), 'already-exists', 'penalty-type-exists')
    await deletePenaltyType(w.deps, admin(), { typeId: id })
    expect(w.penaltyTypes.has(id)).toBe(false)
    expect(w.audits.map((a) => a.action)).toEqual(expect.arrayContaining(['penaltyType.create', 'penaltyType.update', 'penaltyType.delete']))
  })

  it('only the admin manages types; nobody sees another tenant’s type', async () => {
    for (const c of [safety(), sup1(), caller('officer', 'officer'), caller('sec', 'security')]) {
      await rejects(createPenaltyType(w.deps, c, { name: 'Damage' }), 'permission-denied', 'forbidden')
      await rejects(deletePenaltyType(w.deps, c, { typeId }), 'permission-denied', 'forbidden')
    }
    w.penaltyTypes.set('pty_foreign', { tenantId: 'T2', name: 'X', nameKey: 'x', createdBy: 'z' })
    await rejects(updatePenaltyType(w.deps, admin(), { typeId: 'pty_foreign', name: 'Hack' }), 'not-found', 'penalty-type-not-found')
    await rejects(deletePenaltyType(w.deps, admin(), { typeId: 'pty_foreign' }), 'not-found', 'penalty-type-not-found')
  })

  it('refuses to remove a type that a penalty uses, and caps the list', async () => {
    await issue()
    await rejects(deletePenaltyType(w.deps, admin(), { typeId }), 'failed-precondition', 'penalty-type-in-use')
    expect(w.penaltyTypes.has(typeId)).toBe(true)
    for (let i = 0; i < 49; i++) await createPenaltyType(w.deps, admin(), { name: `Type ${i}` })
    await rejects(createPenaltyType(w.deps, admin(), { name: 'One too many' }), 'failed-precondition', 'penalty-type-limit')
  })

  it('rejects a bad name', async () => {
    await rejects(createPenaltyType(w.deps, admin(), { name: 'x' }), 'invalid-argument')
    await rejects(createPenaltyType(w.deps, admin(), { name: 'y'.repeat(41) }), 'invalid-argument')
  })
})

describe('issuePenalty', () => {
  it('a Safety Officer issues a permanent penalty on a vehicle: active at once, unverified, labels from the server, audited', async () => {
    expect(await issue()).toEqual({ penaltyId: PID, created: true })
    expect(stored()).toMatchObject({
      tenantId: 'T1',
      contractorId: 'C1',
      target: { driverId: null, vehicleId: VID },
      targetLabels: { driverName: null, plateNo: 'WP LJ-4821' },
      typeId,
      typeName: 'Safety Violation',
      duration: { kind: 'permanent' },
      issuedBy: { uid: 'safe1', role: 'safety' },
      issuedAt: NOW_MS,
      status: 'active',
      evidencePhotoPath: null,
      verification: { verifiedBy: null, verifiedAt: null, verificationNote: null },
    })
    expect(w.audits.at(-1)).toMatchObject({ action: 'penalty.issue', targetType: 'penalty', targetId: PID, actorRole: 'safety' })
  })

  it('an admin can issue too, on a driver and a vehicle together', async () => {
    await issue(admin(), { driverId: 'drv1' })
    expect(stored()).toMatchObject({ target: { driverId: 'drv1', vehicleId: VID }, targetLabels: { driverName: 'Dan Driver' }, issuedBy: { role: 'admin' } })
  })

  it('fixed duration stores the END of that day in the company timezone; a past date is refused', async () => {
    // NOW = 2023-11-15 03:43 in Colombo (UTC+5:30). End of 2023-11-15 there = 2023-11-15 18:29:59.999 UTC.
    await issue(safety(), { duration: { kind: 'fixed', endDate: '2023-11-15' } })
    expect(stored().duration).toEqual({ kind: 'fixed', endDate: Date.UTC(2023, 10, 15, 18, 29, 59, 999) })
    await rejects(issue(safety(), { penaltyId: PID2, duration: { kind: 'fixed', endDate: '2023-11-14' } }), 'invalid-argument', 'end-date-invalid')
    await rejects(issue(safety(), { penaltyId: PID2, duration: { kind: 'fixed', endDate: '2023-13-45' } }), 'invalid-argument')
  })

  it('only admin and Safety Officer may issue', async () => {
    for (const c of [sup1(), caller('officer', 'officer'), caller('sec', 'security'), caller('drv1', 'driver', 'C1')]) {
      await rejects(issue(c), 'permission-denied', 'forbidden')
    }
    expect(w.penalties.size).toBe(0)
  })

  it('needs a target, a known type, a real reason, and targets of this company only', async () => {
    await rejects(issuePenalty(w.deps, safety(), { penaltyId: PID, typeId, duration: { kind: 'permanent' }, reason: 'Some reason' }), 'invalid-argument', 'invalid-input')
    await rejects(issue(safety(), { typeId: 'pty_none' }), 'not-found', 'penalty-type-not-found')
    await rejects(issue(safety(), { reason: 'no' }), 'invalid-argument', 'invalid-input')
    await rejects(issue(safety(), { vehicleId: 'ghost' }), 'not-found', 'vehicle-not-found')
    await rejects(issue(safety(), { vehicleId: undefined, driverId: 'foreign' }), 'not-found', 'user-not-found')
    await rejects(issue(safety(), { penaltyId: 'bad id' }), 'invalid-argument', 'invalid-input')
    expect(w.penalties.size).toBe(0)
  })

  it('can target a driver that predates Module 2 (no drivers doc), named from the users record', async () => {
    w.users.set('legacy', { ...w.users.get('drv1')!, name: 'Old Timer' })
    await issue(safety(), { vehicleId: undefined, driverId: 'legacy' })
    expect(stored()).toMatchObject({ contractorId: 'C1', target: { driverId: 'legacy', vehicleId: null }, targetLabels: { driverName: 'Old Timer' } })
  })

  it('a driver and a vehicle of different contractors cannot share one penalty', async () => {
    await rejects(issue(safety(), { driverId: 'drv2' }), 'invalid-argument', 'target-mismatch')
  })

  it('retrying the same call returns the stored penalty; another issuer or tenant gets a conflict', async () => {
    await issue()
    expect(await issue()).toEqual({ penaltyId: PID, created: false })
    expect(w.penalties.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'penalty.issue')).toHaveLength(1)
    await rejects(issue(admin()), 'already-exists', 'request-conflict')
  })

  describe('evidence photo', () => {
    const path = penaltyEvidencePath('T1', PID)
    const file = (over: Record<string, unknown> = {}) =>
      w.files.set(path, { contentType: 'image/jpeg', size: 200_000, timeCreated: NOW_MS - 60_000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), ...over })

    it('is verified and stored as a path, never a URL; the audit entry carries no path', async () => {
      file()
      await issue(safety(), { hasEvidence: true })
      expect(stored().evidencePhotoPath).toBe(path)
      expect(JSON.stringify(w.audits.at(-1))).not.toContain('evidence.jpg')
    })

    it('is refused when missing, not a JPEG, too big, or stale', async () => {
      await rejects(issue(safety(), { hasEvidence: true }), 'failed-precondition', 'evidence-missing')
      file({ head: new Uint8Array([1, 2, 3, 4]) })
      await rejects(issue(safety(), { hasEvidence: true }), 'failed-precondition', 'evidence-invalid')
      file({ size: 5_000_000 })
      await rejects(issue(safety(), { hasEvidence: true }), 'failed-precondition', 'evidence-invalid')
      file({ timeCreated: NOW_MS - 3 * 60 * 60_000 })
      await rejects(issue(safety(), { hasEvidence: true }), 'failed-precondition', 'evidence-stale')
      expect(w.penalties.size).toBe(0)
    })
  })
})

describe('revokePenalty', () => {
  beforeEach(() => issue())

  it('only an admin revokes, with a note; the penalty stops being active; audited', async () => {
    for (const c of [safety(), sup1()]) await rejects(revokePenalty(w.deps, c, { penaltyId: PID, note: 'Mistake' }), 'permission-denied', 'forbidden')
    await rejects(revokePenalty(w.deps, admin(), { penaltyId: PID, note: '' }), 'invalid-argument', 'invalid-input')
    await revokePenalty(w.deps, admin(), { penaltyId: PID, note: 'Issued in error' })
    expect(stored()).toMatchObject({ status: 'revoked', revocation: { byUid: 'admin', note: 'Issued in error', at: NOW_MS } })
    expect(w.audits.at(-1)).toMatchObject({ action: 'penalty.revoke', targetId: PID })
  })

  it('cannot revoke twice, an ended penalty, or another tenant’s', async () => {
    await revokePenalty(w.deps, admin(), { penaltyId: PID, note: 'Issued in error' })
    await rejects(revokePenalty(w.deps, admin(), { penaltyId: PID, note: 'Again please' }), 'failed-precondition', 'penalty-not-active')
    w.penalties.set(PID2, { ...stored(), status: 'expired' })
    await rejects(revokePenalty(w.deps, admin(), { penaltyId: PID2, note: 'Already over' }), 'failed-precondition', 'penalty-not-active')
    w.penalties.set('pen_cccccccccc', { ...stored(), tenantId: 'T2', status: 'active' })
    await rejects(revokePenalty(w.deps, admin(), { penaltyId: 'pen_cccccccccc', note: 'Not mine!' }), 'not-found', 'penalty-not-found')
  })
})

describe('verifyPenalty', () => {
  beforeEach(() => issue())

  it('the supervisor of that contractor confirms it was reviewed; the penalty stays active', async () => {
    await verifyPenalty(w.deps, sup1(), { penaltyId: PID, note: ' Spoke to the driver ' })
    expect(stored()).toMatchObject({ status: 'active', verification: { verifiedBy: 'sup1', verifiedAt: NOW_MS, verificationNote: 'Spoke to the driver' } })
    expect(w.audits.at(-1)).toMatchObject({ action: 'penalty.verify', actorRole: 'supervisor' })
  })

  it('the note is optional', async () => {
    await verifyPenalty(w.deps, sup1(), { penaltyId: PID })
    expect(stored().verification.verificationNote).toBeNull()
  })

  it('works on an ended penalty, not on a revoked one, and only once', async () => {
    w.penalties.set(PID, { ...stored(), status: 'expired' })
    await verifyPenalty(w.deps, sup1(), { penaltyId: PID })
    await rejects(verifyPenalty(w.deps, sup1(), { penaltyId: PID }), 'failed-precondition', 'already-verified')
    w.penalties.set(PID2, { ...stored(), status: 'revoked', verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null } })
    await rejects(verifyPenalty(w.deps, sup1(), { penaltyId: PID2 }), 'failed-precondition', 'penalty-revoked')
  })

  it('only supervisors, and only for their own contractor (another contractor’s looks missing)', async () => {
    await rejects(verifyPenalty(w.deps, sup2(), { penaltyId: PID }), 'not-found', 'penalty-not-found')
    for (const c of [admin(), safety(), caller('officer', 'officer')]) await rejects(verifyPenalty(w.deps, c, { penaltyId: PID }), 'permission-denied', 'forbidden')
    expect(stored().verification.verifiedBy).toBeNull()
  })
})
