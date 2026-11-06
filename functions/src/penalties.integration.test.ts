// Runs the real Firestore adapters for penalties (types, issue, revoke, verify, live eligibility, scheduled expiry)
// against the emulator. Without FIRESTORE_EMULATOR_HOST the whole file is skipped.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkEligibility } from './checkEligibility.js'
import type { Deps } from './core.js'
import { dataPort } from './ports.js'
import { createPenaltyType, deletePenaltyType, issuePenalty, revokePenalty, updatePenaltyType, verifyPenalty } from './penalties.js'
import { expirePenalties } from './penaltyExpiry.js'
import { penaltyExpiryPort } from './penaltyExpiryPort.js'
import { admin, caller, makeWorld, NOW, rejects, sup1, userDoc } from './test-utils.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const NOW_MS = NOW * 1000
const DAY = 86_400_000

describe.skipIf(!emulator)('penalties on the Firestore emulator', () => {
  let db: FirebaseFirestore.Firestore
  let deps: Deps
  const safety = () => caller('safe1', 'safety')

  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })

  beforeEach(async () => {
    for (const c of ['penalties', 'penaltyTypes', 'auditLog', 'users', 'drivers', 'vehicles', 'contractors', 'tenants']) {
      await db.recursiveDelete(db.collection(c))
    }
    deps = { ...makeWorld().deps, data: dataPort() }
    await db.doc('tenants/T1').set({ timezone: 'Asia/Colombo' })
    for (const id of ['C1', 'C2']) await db.doc(`contractors/${id}`).set({ tenantId: 'T1', status: 'active' })
    await db.doc('users/admin').set(userDoc({ role: 'admin', contractorId: null, name: 'Ann Admin', email: 'a@x.com', phone: null }))
    await db.doc('users/safe1').set(userDoc({ role: 'safety', contractorId: null, name: 'Sam Safety', email: 'sf@x.com', phone: null }))
    await db.doc('users/sup1').set(userDoc({ role: 'supervisor', contractorId: 'C1', name: 'Sue', email: 's1@x.com', phone: null }))
    await db.doc('vehicles/veh_aaaaaaaaaa').set({ tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active' })
    await db.doc('drivers/drv1').set({ tenantId: 'T1', contractorId: 'C1', name: 'Dan Driver', phone: null, status: 'active' })
  })

  it('types: create, reject a duplicate ignoring case, rename, and refuse removal while used', async () => {
    const { typeId } = await createPenaltyType(deps, admin(), { name: 'Safety Violation' })
    await rejects(createPenaltyType(deps, admin(), { name: 'safety  violation' }), 'already-exists', 'penalty-type-exists')
    const other = await createPenaltyType(deps, admin(), { name: 'Late Return' })
    await rejects(updatePenaltyType(deps, admin(), { typeId: other.typeId, name: 'SAFETY VIOLATION' }), 'already-exists', 'penalty-type-exists')
    await updatePenaltyType(deps, admin(), { typeId: other.typeId, name: 'Late Returns' })
    expect((await db.doc(`penaltyTypes/${other.typeId}`).get()).data()).toMatchObject({ name: 'Late Returns', nameKey: 'late returns', tenantId: 'T1' })

    await issuePenalty(deps, safety(), { penaltyId: 'pen_aaaaaaaaaa', vehicleId: 'veh_aaaaaaaaaa', typeId, duration: { kind: 'permanent' }, reason: 'No helmet on site' })
    await rejects(deletePenaltyType(deps, admin(), { typeId }), 'failed-precondition', 'penalty-type-in-use')
    await deletePenaltyType(deps, admin(), { typeId: other.typeId })
    expect((await db.doc(`penaltyTypes/${other.typeId}`).get()).exists).toBe(false)
    expect((await db.collection('auditLog').where('action', '==', 'penaltyType.delete').get()).size).toBe(1)
  })

  it('issue -> live check blocks -> verify keeps it active -> revoke unblocks, with audit entries', async () => {
    const { typeId } = await createPenaltyType(deps, admin(), { name: 'Damage' })
    expect(await issuePenalty(deps, safety(), { penaltyId: 'pen_aaaaaaaaaa', vehicleId: 'veh_aaaaaaaaaa', driverId: 'drv1', typeId, duration: { kind: 'fixed', endDate: '2023-11-20' }, reason: 'Hit the gate post' })).toEqual({ penaltyId: 'pen_aaaaaaaaaa', created: true })
    // A retry of the same call returns the stored penalty and writes nothing more.
    expect(await issuePenalty(deps, safety(), { penaltyId: 'pen_aaaaaaaaaa', vehicleId: 'veh_aaaaaaaaaa', driverId: 'drv1', typeId, duration: { kind: 'fixed', endDate: '2023-11-20' }, reason: 'Hit the gate post' })).toEqual({ penaltyId: 'pen_aaaaaaaaaa', created: false })

    const stored = (await db.doc('penalties/pen_aaaaaaaaaa').get()).data() as Record<string, unknown>
    expect(stored).toMatchObject({ status: 'active', contractorId: 'C1', target: { driverId: 'drv1', vehicleId: 'veh_aaaaaaaaaa' }, verification: { verifiedBy: null } })
    expect((stored.duration as { endDate: { toMillis(): number } }).endDate.toMillis()).toBe(Date.UTC(2023, 10, 20, 18, 29, 59, 999))

    const security = caller('sec', 'security')
    await db.doc('users/sec').set(userDoc({ role: 'security', contractorId: null, name: 'Sam', email: 'sec@x.com', phone: null }))
    const blocked = await checkEligibility(deps, security, { vehicleId: 'veh_aaaaaaaaaa', driverId: 'drv1' })
    expect(blocked).toMatchObject({ status: 'blocked', blocked: true, vehicle: { blocked: true }, driver: { blocked: true } })
    expect(blocked.vehicle?.penalties[0]).toMatchObject({ typeName: 'Damage', permanent: false })

    await verifyPenalty(deps, sup1(), { penaltyId: 'pen_aaaaaaaaaa', note: 'Seen' })
    await rejects(verifyPenalty(deps, sup1(), { penaltyId: 'pen_aaaaaaaaaa' }), 'failed-precondition', 'already-verified')
    expect((await checkEligibility(deps, security, { driverId: 'drv1' })).blocked).toBe(true)

    await revokePenalty(deps, admin(), { penaltyId: 'pen_aaaaaaaaaa', note: 'Issued in error' })
    expect((await checkEligibility(deps, security, { vehicleId: 'veh_aaaaaaaaaa', driverId: 'drv1' })).status).toBe('valid')
    const actions = (await db.collection('auditLog').get()).docs.map((d) => d.get('action') as string).sort()
    expect(actions).toEqual(expect.arrayContaining(['penalty.issue', 'penalty.verify', 'penalty.revoke']))
  })

  it('scheduled expiry flips only active fixed penalties past their end, and writes a system audit entry', async () => {
    const { typeId } = await createPenaltyType(deps, admin(), { name: 'Late Return' })
    const base = { tenantId: 'T1', contractorId: 'C1', target: { driverId: null, vehicleId: 'veh_aaaaaaaaaa' }, targetLabels: { driverName: null, plateNo: 'X' }, typeId, typeName: 'Late Return', issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: new Date(NOW_MS - 5 * DAY), reason: 'Reason', evidencePhotoPath: null, verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null } }
    const at = (ms: number) => new Date(ms)
    await db.doc('penalties/past').set({ ...base, status: 'active', duration: { kind: 'fixed', endDate: at(NOW_MS - DAY) } })
    await db.doc('penalties/future').set({ ...base, status: 'active', duration: { kind: 'fixed', endDate: at(NOW_MS + DAY) } })
    await db.doc('penalties/perm').set({ ...base, status: 'active', duration: { kind: 'permanent' } })
    await db.doc('penalties/revoked').set({ ...base, status: 'revoked', duration: { kind: 'fixed', endDate: at(NOW_MS - DAY) } })

    expect(await expirePenalties(penaltyExpiryPort(), NOW_MS)).toMatchObject({ due: 1, expired: 1, failedPages: 0 })
    const status = async (id: string) => (await db.doc(`penalties/${id}`).get()).get('status') as string
    expect([await status('past'), await status('future'), await status('perm'), await status('revoked')]).toEqual(['expired', 'active', 'active', 'revoked'])
    expect((await db.doc('penalties/past').get()).get('expiredAt')).toBeTruthy()
    const entries = (await db.collection('auditLog').where('action', '==', 'penalty.expire').get()).docs.map((d) => d.data())
    expect(entries).toEqual([expect.objectContaining({ actorRole: 'system', actorUid: 'system', targetId: 'past', tenantId: 'T1' })])
    // Idempotent.
    expect(await expirePenalties(penaltyExpiryPort(), NOW_MS)).toMatchObject({ due: 0, expired: 0 })
  })

  it('an expired-but-not-yet-flipped penalty no longer blocks the live check', async () => {
    const { typeId } = await createPenaltyType(deps, admin(), { name: 'Late Return' })
    await db.doc('penalties/stale').set({ tenantId: 'T1', contractorId: 'C1', target: { driverId: 'drv1', vehicleId: null }, targetLabels: { driverName: 'Dan', plateNo: null }, typeId, typeName: 'Late Return', issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: new Date(NOW_MS - 5 * DAY), reason: 'Reason', evidencePhotoPath: null, status: 'active', duration: { kind: 'fixed', endDate: new Date(NOW_MS - 1) }, verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null } })
    expect((await checkEligibility(deps, admin(), { driverId: 'drv1' })).blocked).toBe(false)
  })
})
