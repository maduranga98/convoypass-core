import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const A = 'tenantA'
const B = 'tenantB'

let env: RulesTestEnvironment

const userDoc = (over: Record<string, unknown>) => ({
  tenantId: A,
  role: 'driver',
  contractorId: 'c1',
  name: 'N',
  email: null,
  phone: '94771234567',
  status: 'active',
  mustChangePassword: false,
  ...over,
})

const contractorDoc = (tenantId: string, name: string) => ({
  tenantId,
  name,
  status: 'active',
  createdAt: new Date(),
  createdBy: 'seed',
  updatedAt: new Date(),
})

const vehicleDoc = (tenantId: string, contractorId: string, assignedDriverIds: string[]) => ({
  tenantId,
  contractorId,
  plateNo: 'CAB-1234',
  plateKey: 'CAB1234',
  type: 'Tipper',
  assignedDriverIds,
  status: 'active',
  createdAt: new Date(),
  createdBy: 'seed',
  updatedAt: new Date(),
})

const driverProfile = (tenantId: string, contractorId: string) => ({
  tenantId,
  contractorId,
  name: 'D',
  phone: '94771234567',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-conveypass-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'tenants', A), { name: 'A', status: 'active' })
    await setDoc(doc(db, 'tenants', B), { name: 'B', status: 'active' })
    await setDoc(doc(db, 'users', 'adminA'), userDoc({ role: 'admin', contractorId: null }))
    await setDoc(doc(db, 'users', 'adminB'), userDoc({ tenantId: B, role: 'admin', contractorId: null }))
    await setDoc(doc(db, 'users', 'supA1'), userDoc({ role: 'supervisor', contractorId: 'c1' }))
    await setDoc(doc(db, 'users', 'drvA1'), userDoc({ contractorId: 'c1' }))
    await setDoc(doc(db, 'users', 'drvA1b'), userDoc({ contractorId: 'c1', phone: '94770000001' }))
    await setDoc(doc(db, 'users', 'drvA2'), userDoc({ contractorId: 'c2', phone: '94770000002' }))
    await setDoc(doc(db, 'users', 'drvB1'), userDoc({ tenantId: B, contractorId: 'cB' }))
    await setDoc(doc(db, 'contractors', 'c1'), contractorDoc(A, 'C1'))
    await setDoc(doc(db, 'contractors', 'c2'), contractorDoc(A, 'C2'))
    await setDoc(doc(db, 'contractors', 'cB'), contractorDoc(B, 'CB'))
    await setDoc(doc(db, 'vehicles', 'veh_a1'), vehicleDoc(A, 'c1', ['drvA1']))
    await setDoc(doc(db, 'vehicles', 'veh_a2'), vehicleDoc(A, 'c1', ['drvA1', 'drvA1b']))
    await setDoc(doc(db, 'vehicles', 'veh_a3'), vehicleDoc(A, 'c1', []))
    await setDoc(doc(db, 'vehicles', 'veh_a4'), vehicleDoc(A, 'c2', ['drvA2']))
    await setDoc(doc(db, 'vehicles', 'veh_b1'), vehicleDoc(B, 'cB', ['drvB1']))
    await setDoc(doc(db, 'drivers', 'drvA1'), driverProfile(A, 'c1'))
    await setDoc(doc(db, 'drivers', 'drvA1b'), driverProfile(A, 'c1'))
    await setDoc(doc(db, 'drivers', 'drvA2'), driverProfile(A, 'c2'))
    await setDoc(doc(db, 'drivers', 'drvB1'), driverProfile(B, 'cB'))
    await setDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`), { vehicleId: 'veh_a1' })
    for (const [id, tenantId, contractorId, driverId] of [
      ['veh_a1_20260310', A, 'c1', 'drvA1'],
      ['veh_a2_20260310', A, 'c1', 'drvA1b'],
      ['veh_a4_20260310', A, 'c2', 'drvA2'],
      ['veh_b1_20260310', B, 'cB', 'drvB1'],
    ] as const) {
      await setDoc(doc(db, 'passes', id), { tenantId, contractorId, driverId, status: 'submitted', attempt: 1 })
    }
    await setDoc(doc(db, 'auditLog', 'a1'), { tenantId: A, action: 'user.create' })
    await setDoc(doc(db, 'auditLog', 'b1'), { tenantId: B, action: 'user.create' })
    const when = new Date('2026-03-10T08:00:00Z')
    for (const [id, tenantId, recipientUid] of [
      ['n_drv', A, 'drvA1'],
      ['n_drv2', A, 'drvA1'],
      ['n_sup', A, 'supA1'],
      ['n_other_tenant', B, 'drvA1'], // same uid, wrong tenant: never readable
    ] as const) {
      await setDoc(doc(db, 'notifications', id), {
        tenantId, recipientUid, type: 'pass_approved', title: 't', body: 'b', link: '/driver', createdAt: when, readAt: null, expireAt: when,
      })
    }
    await setDoc(doc(db, 'users', 'drvA1', 'devices', 'dev1'), { token: 'secret-token', enabled: true })
    await setDoc(doc(db, 'rateLimits', 'drvA1_createUser'), { windowStart: 1, count: 1 })
    await setDoc(doc(db, 'pinIndex', 'f'.repeat(64)), { uid: 'drvA1', tenantId: A, role: 'driver', createdAt: when })
    await setDoc(doc(db, 'pinAttempts', `ip-${'e'.repeat(32)}`), { windowStart: when, failures: 3, lockedUntil: when, lockouts: 0, lastLockoutAt: when })
    await setDoc(doc(db, 'operators', 'op1'), { name: 'Olive', email: 'olive@convoypass.test', status: 'active', createdAt: when })
    await setDoc(doc(db, 'platformAuditLog', 'p1'), { actorUid: 'op1', action: 'invite.created', targetRef: 'abcdef12', meta: {}, createdAt: when })
    await setDoc(doc(db, 'setupInvites', 'c'.repeat(64)), { createdAt: when, expiresAt: when, claimedAt: null, claimId: null, usedAt: null, tenantId: null })
    await setDoc(doc(db, 'gateEvents', 'den_platform'), { tenantId: 'tenantC', vehicleId: 'veh_c1', at: when })
    // Penalties: one per contractor of tenant A, one in tenant B; types of both tenants.
    for (const [id, tenantId, contractorId] of [['pen_c1', A, 'c1'], ['pen_c2', A, 'c2'], ['pen_b1', B, 'cB']] as const) {
      await setDoc(doc(db, 'penalties', id), {
        tenantId, contractorId, target: { driverId: null, vehicleId: 'veh_a1' }, typeId: 'pty_1', typeName: 'Damage', duration: { kind: 'permanent' },
        issuedBy: { uid: 'safA', name: 'S', role: 'safety' }, issuedAt: when, reason: 'Reason', evidencePhotoPath: null, status: 'active',
        verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null },
      })
    }
    // Inspections: one per contractor of tenant A, one in tenant B.
    for (const [id, tenantId, contractorId] of [['insp_c1', A, 'c1'], ['insp_c2', A, 'c2'], ['insp_b1', B, 'cB']] as const) {
      await setDoc(doc(db, 'inspections', id), {
        tenantId, contractorId, vehicleId: 'veh_a1', plateNo: 'WP LJ-4821', inspectedBy: { uid: 'safA', name: 'S' }, inspectedAt: when, result: 'approved', notes: 'Fine',
        status: 'active', invalidatedReason: null, invalidatedAt: null,
      })
    }
    // Visits: two of contractor c1 (one checked in, one checked out), one of c2, one in tenant B.
    for (const [id, tenantId, contractorId, status] of [
      ['vis_a1', A, 'c1', 'checked_in'], ['vis_a1_out', A, 'c1', 'checked_out'], ['vis_a2', A, 'c2', 'checked_in'], ['vis_b1', B, 'cB', 'checked_in'],
    ] as const) {
      await setDoc(doc(db, 'visits', id), {
        tenantId, contractorId, vehicleId: 'veh_a1', driverId: 'drvA1', plateNo: 'WP LJ-4821', driverName: 'D', status,
        checkIn: { timestamp: when, dateKey: '20260310', securityUserId: 'secA', securityUserName: 'G', gateId: null, gateLocation: null, requestId: 'r' },
        unloadingCheck: null, checkOut: null, driverOnDutyLock: status === 'checked_in', dwellWarning: false,
      })
    }
    // Gate passes: one per contractor of tenant A, one in tenant B; the month-end list of tenant A and B with one entry each.
    for (const [id, tenantId, contractorId] of [['2026-03_veh_a1_drvA1', A, 'c1'], ['2026-03_veh_a2_drvA2', A, 'c2'], ['2026-03_veh_b1_drvB1', B, 'cB']] as const) {
      await setDoc(doc(db, 'gatePasses', id), {
        tenantId, contractorId, vehicleId: 'veh_a1', driverId: 'drvA1', plateNo: 'WP LJ-4821', driverName: 'D', month: '2026-03', status: 'active',
        issuedAt: when, issuedBy: { uid: 'adminA', name: 'A' }, issueMode: 'manual', blockedReason: null, blockedAt: null, blockNote: null, reactivation: null, expiredAt: null,
      })
    }
    for (const [tenantId, entry] of [[A, 'veh_a1_drvA1'], [B, 'veh_b1_drvB1']] as const) {
      await setDoc(doc(db, 'monthEndQualification', `${tenantId}_2026-04`), { tenantId, month: '2026-04', computedAt: when, qualifiedCount: 1 })
      await setDoc(doc(db, 'monthEndQualification', `${tenantId}_2026-04`, 'entries', entry), { tenantId, month: '2026-04', vehicleId: 'veh_a1', driverId: 'drvA1', contractorId: 'c1', plateNo: 'P', driverName: 'D', computedAt: when })
    }
    await setDoc(doc(db, 'penaltyTypes', 'pty_a'), { tenantId: A, name: 'Damage', nameKey: 'damage', createdBy: 'adminA' })
    await setDoc(doc(db, 'penaltyTypes', 'pty_b'), { tenantId: B, name: 'Damage', nameKey: 'damage', createdBy: 'adminB' })
    await setDoc(doc(db, 'auditLog', 'a2'), { tenantId: A, action: 'pass.submit', actorUid: 'drvA1', targetType: 'pass', createdAt: when })
  })
})

const as = (uid: string, claims: Record<string, unknown>) =>
  env.authenticatedContext(uid, claims).firestore()

const adminA = () => as('adminA', { role: 'admin', tenantId: A })
const supA1 = () => as('supA1', { role: 'supervisor', tenantId: A, contractorId: 'c1' })
const drvA1 = () => as('drvA1', { role: 'driver', tenantId: A, contractorId: 'c1' })
const officerA = () => as('offA', { role: 'officer', tenantId: A })
const safetyA = () => as('safA', { role: 'safety', tenantId: A })
const securityA = () => as('secA', { role: 'security', tenantId: A })
const yardA = () => as('yardA', { role: 'yard', tenantId: A })

describe('unauthenticated', () => {
  it('cannot read anything', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users', 'drvA1')))
    await assertFails(getDoc(doc(db, 'tenants', A)))
    await assertFails(getDoc(doc(db, 'contractors', 'c1')))
  })
})

describe('tenant isolation', () => {
  it('denies cross-tenant reads for every collection', async () => {
    const db = adminA()
    await assertFails(getDoc(doc(db, 'users', 'adminB')))
    await assertFails(getDoc(doc(db, 'users', 'drvB1')))
    await assertFails(getDoc(doc(db, 'tenants', B)))
    await assertFails(getDoc(doc(db, 'contractors', 'cB')))
    await assertFails(getDoc(doc(db, 'auditLog', 'b1')))
  })

  it('denies a cross-tenant users query', async () => {
    await assertFails(getDocs(query(collection(adminA(), 'users'), where('tenantId', '==', B))))
  })

  it('allows a tenant-scoped users query for admin', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(adminA(), 'users'), where('tenantId', '==', A))),
    )
    if (snap.size !== 5) throw new Error(`expected 5 tenant users, got ${snap.size}`)
  })

  it('denies an unscoped users query', async () => {
    await assertFails(getDocs(collection(adminA(), 'users')))
  })

  it('denies users whose token lacks claims', async () => {
    const db = env.authenticatedContext('nobody', {}).firestore()
    await assertFails(getDoc(doc(db, 'tenants', A)))
    await assertFails(getDoc(doc(db, 'contractors', 'c1')))
  })

  it('cannot create contractors in another tenant', async () => {
    const db = adminA()
    await assertFails(
      setDoc(doc(db, 'contractors', 'x'), {
        tenantId: B,
        name: 'X',
        status: 'active',
        createdAt: serverTimestamp(),
        createdBy: 'adminA',
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot update a contractor in another tenant', async () => {
    await assertFails(
      updateDoc(doc(adminA(), 'contractors', 'cB'), { name: 'Hacked', updatedAt: serverTimestamp() }),
    )
  })
})

describe('tenants', () => {
  it('members read their own tenant only; nobody writes', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'tenants', A)))
    await assertFails(getDoc(doc(drvA1(), 'tenants', B)))
    await assertFails(updateDoc(doc(adminA(), 'tenants', A), { name: 'x' }))
    await assertFails(setDoc(doc(adminA(), 'tenants', 'new'), { name: 'x' }))
    await assertFails(deleteDoc(doc(adminA(), 'tenants', A)))
  })
})

describe('users', () => {
  it('user reads own doc', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'users', 'drvA1')))
  })

  it('driver cannot read other users', async () => {
    await assertFails(getDoc(doc(drvA1(), 'users', 'drvA1b')))
    await assertFails(getDoc(doc(drvA1(), 'users', 'adminA')))
    await assertFails(getDoc(doc(drvA1(), 'users', 'supA1')))
  })

  it('admin reads any user in tenant', async () => {
    await assertSucceeds(getDoc(doc(adminA(), 'users', 'drvA2')))
    await assertSucceeds(getDoc(doc(adminA(), 'users', 'supA1')))
  })

  it('supervisor sees only drivers of own contractor', async () => {
    const db = supA1()
    await assertSucceeds(getDoc(doc(db, 'users', 'drvA1b')))
    await assertFails(getDoc(doc(db, 'users', 'drvA2')))
    await assertFails(getDoc(doc(db, 'users', 'adminA')))
    await assertFails(getDoc(doc(db, 'users', 'drvB1')))
    await assertSucceeds(getDoc(doc(db, 'users', 'supA1')))
  })

  it('supervisor query is limited to own-contractor drivers', async () => {
    const q = (cid: string) =>
      query(
        collection(supA1(), 'users'),
        where('tenantId', '==', A),
        where('role', '==', 'driver'),
        where('contractorId', '==', cid),
      )
    const own = await assertSucceeds(getDocs(q('c1')))
    if (own.size !== 2) throw new Error(`expected 2 drivers, got ${own.size}`)
    await assertFails(getDocs(q('c2')))
  })

  it('officer and security cannot read other users', async () => {
    await assertFails(getDoc(doc(officerA(), 'users', 'drvA1')))
    await assertFails(getDoc(doc(securityA(), 'users', 'drvA1')))
  })

  it('denies every client write, including own doc and by admin', async () => {
    for (const db of [adminA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'users', 'newUser'), userDoc({})))
      await assertFails(updateDoc(doc(db, 'users', 'drvA1'), { name: 'Hacked' }))
      await assertFails(deleteDoc(doc(db, 'users', 'drvA1')))
    }
    await assertFails(updateDoc(doc(drvA1(), 'users', 'drvA1'), { role: 'admin' }))
    await assertFails(updateDoc(doc(drvA1(), 'users', 'drvA1'), { mustChangePassword: false }))
  })
})

describe('auditLog', () => {
  it('admin reads own tenant audit log only', async () => {
    await assertSucceeds(getDoc(doc(adminA(), 'auditLog', 'a1')))
    await assertFails(getDoc(doc(adminA(), 'auditLog', 'b1')))
  })

  it('non-admins cannot read', async () => {
    for (const db of [supA1(), drvA1(), officerA(), securityA()]) {
      await assertFails(getDoc(doc(db, 'auditLog', 'a1')))
    }
  })

  it('denies all client writes', async () => {
    const entry = { tenantId: A, action: 'x' }
    await assertFails(addDoc(collection(adminA(), 'auditLog'), entry))
    await assertFails(updateDoc(doc(adminA(), 'auditLog', 'a1'), { action: 'y' }))
    await assertFails(deleteDoc(doc(adminA(), 'auditLog', 'a1')))
  })
})

describe('contractors', () => {
  const newContractor = (over: Record<string, unknown> = {}) => ({
    tenantId: A,
    name: 'New Co',
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: 'adminA',
    updatedAt: serverTimestamp(),
    ...over,
  })

  it('reads: admin/officer/security all in tenant; supervisor/driver own only', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c1')))
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c2')))
    }
    for (const db of [supA1(), drvA1()]) {
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c1')))
      await assertFails(getDoc(doc(db, 'contractors', 'c2')))
    }
  })

  it('officer, security, supervisor and driver cannot write', async () => {
    for (const db of [officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'contractors', 'z'), newContractor()))
      await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: 'x', updatedAt: serverTimestamp() }))
    }
  })

  it('admin creates a valid contractor', async () => {
    await assertSucceeds(setDoc(doc(adminA(), 'contractors', 'new'), newContractor({ phone: '0771234567' })))
  })

  it('rejects invalid contractor payloads', async () => {
    const db = adminA()
    await assertFails(setDoc(doc(db, 'contractors', 'n1'), newContractor({ name: '' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n2'), newContractor({ status: 'suspended' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n3'), newContractor({ createdBy: 'someoneElse' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n4'), newContractor({ extra: 1 })))
    await assertFails(setDoc(doc(db, 'contractors', 'n5'), newContractor({ createdAt: new Date() })))
  })

  it('admin edits descriptive fields, including address and notes', async () => {
    const db = adminA()
    await assertSucceeds(
      updateDoc(doc(db, 'contractors', 'c1'), {
        name: 'Renamed',
        contactName: 'Kamal',
        phone: '0771234567',
        address: '1 Main St',
        notes: 'Cement hauler',
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { address: 'x'.repeat(201), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { notes: 'x'.repeat(1001), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: '', updatedAt: serverTimestamp() }))
  })

  it('admin cannot change status (function-only): suspend, activate or anything else', async () => {
    const db = adminA()
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'suspended', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'suspended', name: 'Also renamed', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'deleted', updatedAt: serverTimestamp() }))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'contractors', 'c2'), { status: 'suspended' })
    })
    await assertFails(updateDoc(doc(db, 'contractors', 'c2'), { status: 'active', updatedAt: serverTimestamp() }))
  })

  it('admin cannot change tenant or audit fields, and cannot delete', async () => {
    const db = adminA()
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { tenantId: B, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { createdBy: 'adminA', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: 'x' })) // updatedAt must be the server time
    await assertFails(deleteDoc(doc(db, 'contractors', 'c1')))
  })
})

describe('vehicles', () => {
  const ids = async (db: ReturnType<typeof adminA>, ...constraints: ReturnType<typeof where>[]) =>
    (await assertSucceeds(getDocs(query(collection(db, 'vehicles'), ...constraints)))).docs.map((d) => d.id).sort()

  it('admin, officer, security and safety read every vehicle of their tenant', async () => {
    for (const db of [adminA(), officerA(), securityA(), safetyA()]) {
      expect(await ids(db, where('tenantId', '==', A))).toEqual(['veh_a1', 'veh_a2', 'veh_a3', 'veh_a4'])
      await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a4')))
    }
  })

  it('supervisor reads only their own contractor’s vehicles', async () => {
    const db = supA1()
    expect(await ids(db, where('tenantId', '==', A), where('contractorId', '==', 'c1'))).toEqual(['veh_a1', 'veh_a2', 'veh_a3'])
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a1')))
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a4')))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('contractorId', '==', 'c2'))))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A)))) // would include c2
  })

  it('driver reads only the vehicles they are assigned to', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a1')))
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a2')))
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a3'))) // same contractor, not assigned
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a4')))
    expect(await ids(db, where('tenantId', '==', A), where('assignedDriverIds', 'array-contains', 'drvA1'))).toEqual(['veh_a1', 'veh_a2'])
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('assignedDriverIds', 'array-contains', 'drvA1b'))))
  })

  it('denies cross-tenant reads and queries', async () => {
    for (const db of [adminA(), officerA(), securityA(), safetyA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'vehicles', 'veh_b1')))
    }
    await assertFails(getDocs(query(collection(adminA(), 'vehicles'), where('tenantId', '==', B))))
    await assertFails(getDoc(doc(as('adminB', { role: 'admin', tenantId: B }), 'vehicles', 'veh_a1')))
  })

  it('denies reads without claims and when signed out', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'vehicles', 'veh_a1')))
    await assertFails(getDoc(doc(env.authenticatedContext('x', {}).firestore(), 'vehicles', 'veh_a1')))
  })

  it('denies every client write to vehicles, by every role', async () => {
    for (const db of [adminA(), officerA(), securityA(), safetyA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'vehicles', 'veh_new'), vehicleDoc(A, 'c1', [])))
      await assertFails(addDoc(collection(db, 'vehicles'), vehicleDoc(A, 'c1', [])))
      await assertFails(updateDoc(doc(db, 'vehicles', 'veh_a1'), { status: 'suspended' }))
      await assertFails(updateDoc(doc(db, 'vehicles', 'veh_a1'), { assignedDriverIds: ['drvA1', 'drvA1b'] }))
      await assertFails(deleteDoc(doc(db, 'vehicles', 'veh_a1')))
    }
  })
})

describe('drivers', () => {
  it('admin, officer, security and safety read every driver profile of their tenant', async () => {
    for (const db of [adminA(), officerA(), securityA(), safetyA()]) {
      const snap = await assertSucceeds(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
      expect(snap.docs.map((d) => d.id).sort()).toEqual(['drvA1', 'drvA1b', 'drvA2'])
    }
  })

  it('supervisor reads only their own contractor’s drivers', async () => {
    const db = supA1()
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))),
    )
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['drvA1', 'drvA1b'])
    await assertFails(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertFails(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
  })

  it('a driver reads only their own profile', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'drivers', 'drvA1')))
    await assertFails(getDoc(doc(db, 'drivers', 'drvA1b'))) // same contractor
    await assertFails(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertFails(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
  })

  it('denies cross-tenant reads', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'drivers', 'drvB1')))
    }
    await assertFails(getDocs(query(collection(adminA(), 'drivers'), where('tenantId', '==', B))))
  })

  it('denies every client write to drivers, including a driver editing themselves', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'drivers', 'drvNew'), driverProfile(A, 'c1')))
      await assertFails(updateDoc(doc(db, 'drivers', 'drvA1'), { name: 'Hacked' }))
      await assertFails(updateDoc(doc(db, 'drivers', 'drvA1'), { photoPath: 'tenants/x/y.jpg' }))
      await assertFails(deleteDoc(doc(db, 'drivers', 'drvA1')))
    }
  })
})

describe('vehiclePlates', () => {
  it('has no client access at all', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`)))
      await assertFails(getDocs(collection(db, 'vehiclePlates')))
      await assertFails(setDoc(doc(db, 'vehiclePlates', `${A}_NEW`), { vehicleId: 'veh_a1' }))
      await assertFails(updateDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`), { vehicleId: 'veh_a2' }))
      await assertFails(deleteDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`)))
    }
  })
})

describe('default deny', () => {
  it('denies unknown collections', async () => {
    await assertFails(getDoc(doc(adminA(), 'secrets', 'x')))
    await assertFails(setDoc(doc(adminA(), 'invoices', 'x'), { tenantId: A }))
  })
})

describe('passes', () => {
  it('a driver reads only their own passes (get and query)', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a1_20260310')))
    await assertFails(getDoc(doc(db, 'passes', 'veh_a2_20260310'))) // another driver's pass on a shared vehicle
    await assertFails(getDoc(doc(db, 'passes', 'veh_a4_20260310')))
    const own = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('driverId', '==', 'drvA1'))))
    expect(own.size).toBe(1)
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
  })
  it('a supervisor reads only their contractor’s passes', async () => {
    const db = supA1()
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a1_20260310')))
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a2_20260310')))
    await assertFails(getDoc(doc(db, 'passes', 'veh_a4_20260310')))
    const mine = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))))
    expect(mine.size).toBe(2)
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
  })
  it('admin, officer and security read the whole tenant, never another tenant', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      const all = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
      expect(all.size).toBe(3)
      await assertFails(getDoc(doc(db, 'passes', 'veh_b1_20260310')))
    }
    await assertFails(getDoc(doc(drvA1(), 'passes', 'veh_b1_20260310')))
  })
  it('signed-out users read nothing', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'passes', 'veh_a1_20260310')))
  })
  it('nobody writes passes from the client, whatever the role or status asked for', async () => {
    const fresh = { tenantId: A, contractorId: 'c1', driverId: 'drvA1', status: 'submitted', attempt: 1 }
    for (const db of [adminA(), supA1(), drvA1(), officerA(), securityA()]) {
      await assertFails(setDoc(doc(db, 'passes', 'veh_a3_20260310'), fresh))
      await assertFails(addDoc(collection(db, 'passes'), fresh))
      await assertFails(updateDoc(doc(db, 'passes', 'veh_a1_20260310'), { status: 'officer_approved' }))
      await assertFails(deleteDoc(doc(db, 'passes', 'veh_a1_20260310')))
    }
  })
  it('tenants stay read-only for members', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'tenants', A)))
    await assertFails(updateDoc(doc(adminA(), 'tenants', A), { checklist: [] }))
    await assertFails(updateDoc(doc(drvA1(), 'tenants', A), { passSettings: { requireLocation: true } }))
  })
})

describe('passes: approval queues (Module 4)', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, driverId: string, status: string, over: Record<string, unknown> = {}) => ({
        tenantId, contractorId, driverId, status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
        checklist: [{ id: 'x', label: 'X', answer: 'yes' }], ...over,
      })
      await setDoc(doc(db, 'passes', 'q1'), pass(A, 'c1', 'drvA1', 'submitted'))
      await setDoc(doc(db, 'passes', 'q2'), pass(A, 'c1', 'drvA1b', 'supervisor_approved', { supervisor: { uid: 'supA1', name: 'S' } }))
      await setDoc(doc(db, 'passes', 'q3'), pass(A, 'c2', 'drvA2', 'submitted'))
      await setDoc(doc(db, 'passes', 'q4'), pass(A, 'c2', 'drvA2', 'supervisor_approved', { dateKey: '20260309' }))
      await setDoc(doc(db, 'passes', 'q5'), pass(B, 'cB', 'drvB1', 'submitted'))
    })
  })
  const dayQuery = (db: ReturnType<typeof adminA>, ...extra: ReturnType<typeof where>[]) =>
    getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), ...extra))

  it('a supervisor’s live queue only works scoped to their contractor, and never shows another contractor', async () => {
    const db = supA1()
    const mine = await assertSucceeds(dayQuery(db, where('contractorId', '==', 'c1'), where('status', 'in', ['submitted', 'supervisor_approved']), where('dateKey', '==', DAY)))
    expect(mine.docs.map((d) => d.id).sort()).toEqual(['q1', 'q2'])
    await assertFails(dayQuery(db, where('contractorId', '==', 'c2'), where('status', '==', 'submitted')))
    await assertFails(dayQuery(db, where('status', '==', 'submitted'))) // not scoped to the contractor
    await assertFails(getDoc(doc(db, 'passes', 'q3')))
  })
  it('an officer’s queue (status + day, and the expired range) reads across contractors in the tenant only', async () => {
    const db = officerA()
    const awaiting = await assertSucceeds(dayQuery(db, where('status', '==', 'supervisor_approved'), where('dateKey', '==', DAY)))
    expect(awaiting.docs.map((d) => d.id)).toEqual(['q2'])
    const expired = await assertSucceeds(dayQuery(db, where('status', 'in', ['submitted', 'supervisor_approved']), where('dateKey', '<', DAY)))
    expect(expired.docs.map((d) => d.id)).toEqual(['q4'])
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B))))
    await assertFails(getDoc(doc(db, 'passes', 'q5')))
  })
  it('admin reads the day list for the tenant, not another tenant’s', async () => {
    const day = await assertSucceeds(dayQuery(adminA(), where('dateKey', '==', DAY)))
    expect(day.size).toBe(3)
    await assertFails(getDoc(doc(adminA(), 'passes', 'q5')))
  })
  it('a driver reads only their own, and not through a tenant-wide or contractor-wide query', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'passes', 'q1')))
    await assertFails(getDoc(doc(drvA1(), 'passes', 'q2')))
    await assertFails(dayQuery(drvA1(), where('contractorId', '==', 'c1')))
  })
  it('no role can write any decision field, create a history entry or delete (all of it is function-only)', async () => {
    const decisions = [
      { status: 'supervisor_approved' },
      { status: 'officer_approved', officer: { uid: 'x', name: 'X' } },
      { status: 'rejected', rejection: { reason: 'r', reasonCode: 'other', stage: 'officer' } },
      { history: [] },
      { supervisor: { uid: 'x', name: 'X' } },
    ]
    for (const db of [adminA(), supA1(), drvA1(), officerA(), securityA()]) {
      for (const patch of decisions) await assertFails(updateDoc(doc(db, 'passes', 'q1'), patch))
      await assertFails(deleteDoc(doc(db, 'passes', 'q1')))
    }
  })
  it('members read rejectionReasons from their tenant document but cannot change it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants', A), { name: 'A', status: 'active', rejectionReasons: [{ id: 'other', label: 'Other' }] })
    })
    for (const db of [adminA(), supA1(), officerA(), drvA1()]) {
      const snap = await assertSucceeds(getDoc(doc(db, 'tenants', A)))
      expect(snap.data()?.rejectionReasons).toEqual([{ id: 'other', label: 'Other' }])
      await assertFails(updateDoc(doc(db, 'tenants', A), { rejectionReasons: [] }))
    }
  })
})

describe('the gate (Module 5)', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, driverId: string, status: string) => ({
        tenantId, contractorId, driverId, status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
      })
      await setDoc(doc(db, 'passes', 'g1'), pass(A, 'c1', 'drvA1', 'officer_approved'))
      await setDoc(doc(db, 'passes', 'g2'), pass(A, 'c2', 'drvA2', 'checked_in'))
      await setDoc(doc(db, 'passes', 'g3'), pass(A, 'c1', 'drvA1b', 'submitted'))
      await setDoc(doc(db, 'passes', 'gB'), pass(B, 'cB', 'drvB1', 'officer_approved'))
      const event = (tenantId: string) => ({
        tenantId, type: 'denied', vehicleId: 'veh_a1', plateNo: 'CAB-1234', contractorId: 'c1', passId: null, passStatus: null,
        reasonCode: 'not_approved', gateId: 'main', gateName: 'Main Gate', byUid: 'secA', byName: 'S', at: new Date(), requestId: 'r',
      })
      await setDoc(doc(db, 'gateEvents', 'den_a'), event(A))
      await setDoc(doc(db, 'gateEvents', 'den_b'), event(B))
      await setDoc(doc(db, 'tenants', A), { name: 'A', status: 'active', gates: [{ id: 'main', name: 'Main Gate' }] })
    })
  })

  it('security reads the tenant’s vehicles, drivers and contractors (get and the gate home queries)', async () => {
    const db = securityA()
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a4')))
    const vehicles = await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), orderBy('plateKey'), limit(1000))))
    expect(vehicles.size).toBe(4)
    await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('plateKey', '>=', 'CAB'), where('plateKey', '<', 'CAB\uf8ff'), orderBy('plateKey'), limit(8))))
    await assertSucceeds(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertSucceeds(getDoc(doc(db, 'contractors', 'c2')))
    await assertSucceeds(getDocs(query(collection(db, 'contractors'), where('tenantId', '==', A), orderBy('createdAt', 'desc'))))
  })
  it('security reads today’s approved and checked-in passes across contractors, and a single pass', async () => {
    const db = securityA()
    const live = await assertSucceeds(
      getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY), where('status', 'in', ['officer_approved', 'checked_in']), limit(300))),
    )
    expect(live.docs.map((d) => d.id).sort()).toEqual(['g1', 'g2'])
    await assertSucceeds(getDoc(doc(db, 'passes', 'g3')))
  })
  it('security is denied cross-tenant reads and unscoped queries', async () => {
    const db = securityA()
    for (const [col, id] of [['passes', 'gB'], ['vehicles', 'veh_b1'], ['drivers', 'drvB1'], ['contractors', 'cB'], ['tenants', B]] as const) {
      await assertFails(getDoc(doc(db, col, id)))
    }
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B))))
    await assertFails(getDocs(collection(db, 'vehicles')))
  })
  it('members read the gates from their tenant document but nobody writes it', async () => {
    for (const db of [securityA(), adminA(), officerA(), supA1()]) {
      const snap = await assertSucceeds(getDoc(doc(db, 'tenants', A)))
      expect(snap.data()?.gates).toEqual([{ id: 'main', name: 'Main Gate' }])
      await assertFails(updateDoc(doc(db, 'tenants', A), { gates: [] }))
    }
  })
  it('gateEvents: admin and officer read their tenant’s log only', async () => {
    for (const db of [adminA(), officerA()]) {
      await assertSucceeds(getDoc(doc(db, 'gateEvents', 'den_a')))
      const log = await assertSucceeds(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A), where('at', '>=', new Date(0)), orderBy('at', 'desc'))))
      expect(log.docs.map((d) => d.id)).toEqual(['den_a'])
      await assertFails(getDoc(doc(db, 'gateEvents', 'den_b')))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', B))))
    }
  })
  it('gateEvents: security, supervisors and drivers have no access', async () => {
    for (const db of [securityA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'gateEvents', 'den_a')))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A))))
    }
  })
  it('gateEvents are never written from the client, by any role', async () => {
    const event = { tenantId: A, type: 'denied', vehicleId: 'veh_a1', reasonCode: 'other', byUid: 'secA', at: serverTimestamp() }
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'gateEvents', 'den_x'), event))
      await assertFails(addDoc(collection(db, 'gateEvents'), event))
      await assertFails(updateDoc(doc(db, 'gateEvents', 'den_a'), { note: 'changed' }))
      await assertFails(deleteDoc(doc(db, 'gateEvents', 'den_a')))
    }
  })
  it('no client can check a pass in: status, checkIn block and history stay function-only', async () => {
    const patches = [
      { status: 'checked_in' },
      { checkIn: { uid: 'secA', name: 'S', gateId: 'main', requestId: 'r' } },
      { status: 'checked_in', checkIn: { uid: 'secA' }, history: [{ action: 'check_in' }] },
    ]
    for (const db of [securityA(), adminA(), officerA(), supA1(), drvA1()]) {
      for (const patch of patches) await assertFails(updateDoc(doc(db, 'passes', 'g1'), patch))
      await assertFails(setDoc(doc(db, 'passes', 'g1'), { tenantId: A, status: 'checked_in' }))
    }
  })
})

describe('dashboard and reports (Module 6): nothing new, nothing loosened', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, status: string) => ({
        tenantId, contractorId, driverId: 'drvA1', status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
      })
      await setDoc(doc(db, 'passes', 'm1'), pass(A, 'c1', 'submitted'))
      await setDoc(doc(db, 'passes', 'm2'), pass(A, 'c2', 'checked_in'))
      await setDoc(doc(db, 'passes', 'mB'), pass(B, 'cB', 'submitted'))
      await setDoc(doc(db, 'gateEvents', 'den_a'), {
        tenantId: A, type: 'denied', vehicleId: 'veh_a1', plateNo: 'CAB-1234', contractorId: 'c1', reasonCode: 'other', gateId: 'main',
        gateName: 'Main Gate', byUid: 'secA', byName: 'S', at: new Date(), requestId: 'r',
      })
    })
  })

  it('admin and officer read today’s tenant passes (the live dashboard query) and never another tenant’s', async () => {
    for (const db of [adminA(), officerA()]) {
      const today = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY), limit(1000))))
      expect(today.docs.map((d) => d.id).sort()).toEqual(['m1', 'm2'])
      await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B), where('dateKey', '==', DAY))))
      await assertFails(getDoc(doc(db, 'passes', 'mB')))
    }
  })
  it('admin and officer read the tenant’s gate events, vehicles, drivers and contractors', async () => {
    for (const db of [adminA(), officerA()]) {
      const events = await assertSucceeds(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A), where('at', '>=', new Date(0)), orderBy('at', 'desc'), limit(15))))
      expect(events.size).toBe(1)
      await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), orderBy('plateKey'), limit(1000))))
      await assertSucceeds(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A), limit(1000))))
      await assertSucceeds(getDocs(query(collection(db, 'contractors'), where('tenantId', '==', A))))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', B))))
    }
  })
  it('supervisor, driver and security cannot read the tenant-wide passes or the gate events a dashboard needs', async () => {
    for (const db of [supA1(), drvA1(), securityA()]) {
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A))))
    }
    for (const db of [supA1(), drvA1()]) {
      await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY))))
    }
  })
})

describe('notifications (Module 7)', () => {
  const own = (uid: string) => query(collection(drvA1(), 'notifications'), where('tenantId', '==', A), where('recipientUid', '==', uid), orderBy('createdAt', 'desc'), limit(50))

  it('a user reads only their own notifications, in their own tenant', async () => {
    const snap = await assertSucceeds(getDocs(own('drvA1')))
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['n_drv', 'n_drv2'])
    await assertSucceeds(getDoc(doc(drvA1(), 'notifications', 'n_drv')))
    await assertFails(getDoc(doc(drvA1(), 'notifications', 'n_sup'))) // someone else's
    await assertFails(getDoc(doc(drvA1(), 'notifications', 'n_other_tenant'))) // right uid, other tenant
    await assertFails(getDocs(own('supA1'))) // another recipient's query
    await assertFails(getDocs(query(collection(drvA1(), 'notifications'), where('recipientUid', '==', 'drvA1')))) // no tenant constraint
    await assertFails(getDocs(collection(drvA1(), 'notifications'))) // unfiltered
  })
  it('even admins cannot read other people’s notifications', async () => {
    await assertFails(getDoc(doc(adminA(), 'notifications', 'n_drv')))
    await assertFails(getDocs(query(collection(adminA(), 'notifications'), where('tenantId', '==', A))))
  })
  it('a user may update only readAt on their own notification, and only to the server time', async () => {
    const ref = doc(drvA1(), 'notifications', 'n_drv')
    await assertSucceeds(updateDoc(ref, { readAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(drvA1(), 'notifications', 'n_drv2'), { readAt: serverTimestamp() }))
  })
  it('rejects a readAt that is not the request time, other fields, extra fields and other people’s docs', async () => {
    const ref = doc(drvA1(), 'notifications', 'n_drv')
    await assertFails(updateDoc(ref, { readAt: new Date('2020-01-01') }))
    await assertFails(updateDoc(ref, { readAt: null }))
    await assertFails(updateDoc(ref, { title: 'hacked' }))
    await assertFails(updateDoc(ref, { readAt: serverTimestamp(), title: 'hacked' }))
    await assertFails(updateDoc(ref, { readAt: serverTimestamp(), recipientUid: 'supA1' }))
    await assertFails(updateDoc(doc(drvA1(), 'notifications', 'n_sup'), { readAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(drvA1(), 'notifications', 'n_other_tenant'), { readAt: serverTimestamp() }))
  })
  it('no client creates or deletes notifications, not even for themselves', async () => {
    const mine = { tenantId: A, recipientUid: 'drvA1', type: 'x', title: 't', body: 'b', link: '/', createdAt: serverTimestamp(), readAt: null, expireAt: new Date() }
    await assertFails(setDoc(doc(drvA1(), 'notifications', 'new'), mine))
    await assertFails(addDoc(collection(adminA(), 'notifications'), mine))
    await assertFails(deleteDoc(doc(drvA1(), 'notifications', 'n_drv')))
    await assertFails(deleteDoc(doc(adminA(), 'notifications', 'n_drv')))
  })
  it('unauthenticated users have no access', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'notifications', 'n_drv')))
    await assertFails(updateDoc(doc(anon, 'notifications', 'n_drv'), { readAt: serverTimestamp() }))
  })
})

describe('devices and rateLimits (Module 7)', () => {
  it('users/{uid}/devices is closed to every client, including the owner and admins', async () => {
    for (const db of [drvA1(), adminA(), supA1()]) {
      await assertFails(getDoc(doc(db, 'users', 'drvA1', 'devices', 'dev1')))
      await assertFails(getDocs(collection(db, 'users', 'drvA1', 'devices')))
      await assertFails(setDoc(doc(db, 'users', 'drvA1', 'devices', 'dev2'), { token: 'x', enabled: true }))
      await assertFails(updateDoc(doc(db, 'users', 'drvA1', 'devices', 'dev1'), { enabled: false }))
      await assertFails(deleteDoc(doc(db, 'users', 'drvA1', 'devices', 'dev1')))
    }
  })
  it('rateLimits is closed to every client', async () => {
    for (const db of [drvA1(), adminA()]) {
      await assertFails(getDoc(doc(db, 'rateLimits', 'drvA1_createUser')))
      await assertFails(setDoc(doc(db, 'rateLimits', 'drvA1_createUser'), { windowStart: 1, count: 0 }))
      await assertFails(deleteDoc(doc(db, 'rateLimits', 'drvA1_createUser')))
    }
  })
})

describe('pinIndex and pinAttempts (Module 12)', () => {
  const PIN_DOC = 'f'.repeat(64)
  const ATTEMPT_DOC = `ip-${'e'.repeat(32)}`
  it('are unreadable and unwritable by every role, admin included, and by visitors', async () => {
    const everyone = [adminA(), officerA(), supA1(), drvA1(), securityA(), as('adminB', { role: 'admin', tenantId: B }), as('op1', { role: 'platform', platformAdmin: true, email_verified: true }), env.unauthenticatedContext().firestore()]
    for (const db of everyone) {
      await assertFails(getDoc(doc(db, 'pinIndex', PIN_DOC)))
      await assertFails(getDocs(collection(db, 'pinIndex')))
      await assertFails(getDocs(query(collection(db, 'pinIndex'), where('uid', '==', 'drvA1'))))
      await assertFails(setDoc(doc(db, 'pinIndex', 'a'.repeat(64)), { uid: 'drvA1', tenantId: A, role: 'driver' }))
      await assertFails(updateDoc(doc(db, 'pinIndex', PIN_DOC), { uid: 'adminA' }))
      await assertFails(deleteDoc(doc(db, 'pinIndex', PIN_DOC)))
      await assertFails(getDoc(doc(db, 'pinAttempts', ATTEMPT_DOC)))
      await assertFails(getDocs(collection(db, 'pinAttempts')))
      await assertFails(setDoc(doc(db, 'pinAttempts', ATTEMPT_DOC), { failures: 0 }))
      await assertFails(updateDoc(doc(db, 'pinAttempts', ATTEMPT_DOC), { failures: 0, lockedUntil: null }))
      await assertFails(deleteDoc(doc(db, 'pinAttempts', ATTEMPT_DOC)))
    }
  })
})

describe('pinVault ("Show PIN": sealed copies of PINs)', () => {
  it('is unreadable and unwritable by every role, admin and supervisor included, and by visitors', async () => {
    const everyone = [adminA(), officerA(), supA1(), drvA1(), securityA(), as('adminB', { role: 'admin', tenantId: B }), as('op1', { role: 'platform', platformAdmin: true, email_verified: true }), env.unauthenticatedContext().firestore()]
    for (const db of everyone) {
      await assertFails(getDoc(doc(db, 'pinVault', 'drvA1')))
      await assertFails(getDocs(collection(db, 'pinVault')))
      await assertFails(getDocs(query(collection(db, 'pinVault'), where('tenantId', '==', A))))
      await assertFails(setDoc(doc(db, 'pinVault', 'drvA1'), { tenantId: A, sealed: 'x', pinVersion: 1 }))
      await assertFails(updateDoc(doc(db, 'pinVault', 'drvA1'), { sealed: 'y' }))
      await assertFails(deleteDoc(doc(db, 'pinVault', 'drvA1')))
    }
  })
})

describe('auditLog (Module 7 viewer queries)', () => {
  const audit = (db: ReturnType<typeof adminA>, ...extra: Parameters<typeof where>[]) =>
    getDocs(query(collection(db, 'auditLog'), where('tenantId', '==', A), ...extra.map((e) => where(...e)), orderBy('createdAt', 'desc'), limit(26)))

  it('admin reads their tenant’s log with the viewer’s filters, never another tenant’s', async () => {
    expect((await assertSucceeds(audit(adminA()))).size).toBe(1)
    await assertSucceeds(audit(adminA(), ['action', '==', 'pass.submit']))
    await assertSucceeds(audit(adminA(), ['actorUid', '==', 'drvA1']))
    await assertSucceeds(audit(adminA(), ['targetType', '==', 'pass']))
    await assertFails(getDocs(query(collection(adminA(), 'auditLog'), where('tenantId', '==', B), orderBy('createdAt', 'desc'))))
  })
  it('officers, supervisors, drivers and security cannot query it, and nobody can write it', async () => {
    for (const db of [officerA(), supA1(), drvA1(), securityA()]) await assertFails(audit(db))
    await assertFails(setDoc(doc(adminA(), 'auditLog', 'a2'), { tenantId: A, action: 'tampered' }))
    await assertFails(deleteDoc(doc(adminA(), 'auditLog', 'a2')))
  })
})

describe('setupInvites (Module 8)', () => {
  const HASH = 'a'.repeat(64)
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'setupInvites', HASH), {
        createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), claimedAt: null, claimId: null, usedAt: null, tenantId: null,
      })
    })
  })

  it('is unreadable, unlistable and unwritable by every role, including admin and signed-out visitors', async () => {
    const clients = [adminA(), officerA(), supA1(), drvA1(), securityA(), env.unauthenticatedContext().firestore()]
    for (const db of clients) {
      await assertFails(getDoc(doc(db, 'setupInvites', HASH)))
      await assertFails(getDocs(collection(db, 'setupInvites')))
      await assertFails(getDocs(query(collection(db, 'setupInvites'), where('usedAt', '==', null))))
      await assertFails(setDoc(doc(db, 'setupInvites', 'b'.repeat(64)), { expiresAt: new Date(), usedAt: null }))
      await assertFails(updateDoc(doc(db, 'setupInvites', HASH), { usedAt: new Date(), tenantId: A }))
      await assertFails(deleteDoc(doc(db, 'setupInvites', HASH)))
    }
  })
})

describe('platform operators (Module 9)', () => {
  const operator = () => as('op1', { role: 'platform', platformAdmin: true, email_verified: true })
  const COLLECTIONS = ['tenants', 'users', 'contractors', 'vehicles', 'drivers', 'vehiclePlates', 'passes', 'gateEvents', 'auditLog', 'notifications', 'rateLimits', 'setupInvites', 'operators', 'platformAuditLog', 'penalties', 'penaltyTypes', 'inspections', 'visits', 'gatePasses', 'monthEndQualification'] as const
  const KNOWN_DOCS: Record<string, string[]> = {
    tenants: [A, B], users: ['adminA', 'drvA1', 'op1'], contractors: ['c1'], vehicles: ['veh_a1'], drivers: ['drvA1'],
    vehiclePlates: [`${A}_WPLJ4821`], passes: ['veh_a1_20260310'], gateEvents: ['den_platform'], auditLog: ['a1'], notifications: ['n_drv'],
    rateLimits: ['drvA1_createUser'], setupInvites: ['c'.repeat(64)], operators: ['op1'], platformAuditLog: ['p1'], penalties: ['pen_c1'], penaltyTypes: ['pty_a'], inspections: ['insp_c1'], visits: ['vis_a1'], gatePasses: ['2026-03_veh_a1_drvA1'], monthEndQualification: [`${A}_2026-04`],
  }

  it('is denied on every collection: single reads (even of its own uid), lists, tenant-filtered queries and writes', async () => {
    const db = operator()
    for (const col of COLLECTIONS) {
      for (const id of KNOWN_DOCS[col] ?? []) {
        await assertFails(getDoc(doc(db, col, id)))
        await assertFails(setDoc(doc(db, col, id), { tenantId: A, name: 'x' }))
        await assertFails(updateDoc(doc(db, col, id), { name: 'x' }))
        await assertFails(deleteDoc(doc(db, col, id)))
      }
      await assertFails(getDocs(collection(db, col)))
      await assertFails(getDocs(query(collection(db, col), where('tenantId', '==', A))))
      await assertFails(addDoc(collection(db, col), { tenantId: A }))
    }
    await assertFails(getDocs(collection(db, 'users', 'drvA1', 'devices')))
    await assertFails(getDoc(doc(db, 'users', 'drvA1', 'devices', 'dev1')))
    // Even a tenantId claim of an operator-looking token with no role helps nothing, and neither does a spoofed one in the query.
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('driverId', '==', 'op1'))))
  })
  it('an operator token that somehow carried a role and a tenant is a tenant token (claims are set by functions only)', async () => {
    // Documents the boundary: access comes from tenantId + role. The operator claim set has neither.
    const db = as('op1', { role: 'platform', platformAdmin: true })
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'notifications'), where('tenantId', '==', A), where('recipientUid', '==', 'op1'))))
  })
  it('a tenant admin cannot read or write operators or platformAuditLog (and no tenant role can)', async () => {
    for (const db of [adminA(), officerA(), supA1(), drvA1(), securityA(), env.unauthenticatedContext().firestore()]) {
      for (const col of ['operators', 'platformAuditLog']) {
        await assertFails(getDoc(doc(db, col, col === 'operators' ? 'op1' : 'p1')))
        await assertFails(getDocs(collection(db, col)))
        await assertFails(getDocs(query(collection(db, col), where('actorUid', '==', 'op1'))))
        await assertFails(setDoc(doc(db, col, 'new1'), { name: 'x' }))
        await assertFails(updateDoc(doc(db, col, col === 'operators' ? 'op1' : 'p1'), { status: 'active' }))
        await assertFails(deleteDoc(doc(db, col, col === 'operators' ? 'op1' : 'p1')))
      }
    }
  })
  it('setupInvites stays closed to everyone', async () => {
    for (const db of [operator(), adminA(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'setupInvites', 'c'.repeat(64))))
      await assertFails(getDocs(collection(db, 'setupInvites')))
    }
  })
  it('tenant users still read their own profile (the self-read rule needs a tenantId, which they all have)', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'users', 'drvA1')))
    await assertSucceeds(getDoc(doc(adminA(), 'users', 'adminA')))
  })
})

describe('penalties and penalty types', () => {
  const sameTenantQuery = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'penalties'), where('tenantId', '==', A)))
  const own = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'penalties'), where('tenantId', '==', A), where('contractorId', '==', 'c1')))

  it('admin and Safety Officer read every penalty of their company, and nothing of another', async () => {
    for (const db of [adminA(), safetyA()]) {
      expect((await assertSucceeds(sameTenantQuery(db))).docs.map((d) => d.id).sort()).toEqual(['pen_c1', 'pen_c2'])
      await assertSucceeds(getDoc(doc(db, 'penalties', 'pen_c2')))
      await assertFails(getDoc(doc(db, 'penalties', 'pen_b1')))
      await assertFails(getDocs(query(collection(db, 'penalties'), where('tenantId', '==', B))))
    }
  })

  it('a supervisor reads only their own contractor’s penalties; the query must carry the contractor', async () => {
    const db = supA1()
    expect((await assertSucceeds(own(db))).docs.map((d) => d.id)).toEqual(['pen_c1'])
    await assertSucceeds(getDoc(doc(db, 'penalties', 'pen_c1')))
    await assertFails(getDoc(doc(db, 'penalties', 'pen_c2')))
    await assertFails(sameTenantQuery(db))
    await assertSucceeds(getDocs(query(collection(db, 'penalties'), where('tenantId', '==', A), where('contractorId', '==', 'c1'), where('verification.verifiedBy', '==', null))))
  })

  it('officer, security, drivers and signed-out users have no access at all', async () => {
    for (const db of [officerA(), securityA(), drvA1(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'penalties', 'pen_c1')))
      await assertFails(sameTenantQuery(db))
      await assertFails(getDoc(doc(db, 'penaltyTypes', 'pty_a')))
    }
  })

  it('nobody writes a penalty or a type from a client, admins included (callables only)', async () => {
    for (const db of [adminA(), safetyA(), supA1(), securityA()]) {
      await assertFails(addDoc(collection(db, 'penalties'), { tenantId: A, contractorId: 'c1', status: 'active' }))
      await assertFails(setDoc(doc(db, 'penalties', 'pen_new'), { tenantId: A, contractorId: 'c1', status: 'active' }))
      await assertFails(updateDoc(doc(db, 'penalties', 'pen_c1'), { status: 'revoked' }))
      await assertFails(updateDoc(doc(db, 'penalties', 'pen_c1'), { 'verification.verifiedBy': 'supA1' }))
      await assertFails(deleteDoc(doc(db, 'penalties', 'pen_c1')))
      await assertFails(addDoc(collection(db, 'penaltyTypes'), { tenantId: A, name: 'x' }))
      await assertFails(updateDoc(doc(db, 'penaltyTypes', 'pty_a'), { name: 'x' }))
      await assertFails(deleteDoc(doc(db, 'penaltyTypes', 'pty_a')))
    }
  })

  it('admin, Safety Officer and supervisor read their company’s penalty types, and no other company’s', async () => {
    for (const db of [adminA(), safetyA(), supA1()]) {
      expect((await assertSucceeds(getDocs(query(collection(db, 'penaltyTypes'), where('tenantId', '==', A))))).size).toBe(1)
      await assertFails(getDoc(doc(db, 'penaltyTypes', 'pty_b')))
    }
  })
})

describe('inspections', () => {
  const tenantQuery = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'inspections'), where('tenantId', '==', A)))
  const history = (db: ReturnType<typeof adminA>, vehicleId = 'veh_a1') =>
    getDocs(query(collection(db, 'inspections'), where('tenantId', '==', A), where('vehicleId', '==', vehicleId), orderBy('inspectedAt', 'desc')))

  it('admin (oversight) and Safety Officer read every inspection of their company, and nothing of another', async () => {
    for (const db of [adminA(), safetyA()]) {
      expect((await assertSucceeds(tenantQuery(db))).docs.map((d) => d.id).sort()).toEqual(['insp_c1', 'insp_c2'])
      await assertSucceeds(getDoc(doc(db, 'inspections', 'insp_c2')))
      await assertFails(getDoc(doc(db, 'inspections', 'insp_b1')))
      await assertFails(getDocs(query(collection(db, 'inspections'), where('tenantId', '==', B))))
    }
  })

  it('a supervisor reads only their own contractor’s inspections; the query must carry the contractor', async () => {
    const db = supA1()
    expect((await assertSucceeds(getDocs(query(collection(db, 'inspections'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))))).docs.map((d) => d.id)).toEqual(['insp_c1'])
    await assertSucceeds(getDoc(doc(db, 'inspections', 'insp_c1')))
    await assertFails(getDoc(doc(db, 'inspections', 'insp_c2')))
    await assertFails(tenantQuery(db))
  })

  it('officer, security, drivers and signed-out users have no access at all', async () => {
    for (const db of [officerA(), securityA(), drvA1(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'inspections', 'insp_c1')))
      await assertFails(tenantQuery(db))
    }
  })

  it('nobody writes an inspection from a client, Safety Officer and admin included (callables only)', async () => {
    for (const db of [adminA(), safetyA(), supA1(), securityA(), officerA()]) {
      await assertFails(addDoc(collection(db, 'inspections'), { tenantId: A, contractorId: 'c1', status: 'active', result: 'approved' }))
      await assertFails(setDoc(doc(db, 'inspections', 'insp_new'), { tenantId: A, contractorId: 'c1', status: 'active', result: 'approved' }))
      await assertFails(updateDoc(doc(db, 'inspections', 'insp_c1'), { status: 'invalidated' }))
      await assertFails(updateDoc(doc(db, 'inspections', 'insp_c1'), { result: 'approved' }))
      await assertFails(deleteDoc(doc(db, 'inspections', 'insp_c1')))
    }
  })

  it('the per-vehicle history query (tenant + vehicle, newest first) is allowed for admin and Safety Officer', async () => {
    for (const db of [adminA(), safetyA()]) await assertSucceeds(history(db))
  })

  it('the clearance copy on a vehicle is not writable by anyone', async () => {
    for (const db of [adminA(), safetyA(), supA1()]) await assertFails(updateDoc(doc(db, 'vehicles', 'veh_a1'), { clearance: { status: 'cleared', inspectionId: 'insp_c1', reason: null, at: 1 } }))
  })
})

describe('gatePasses (monthly gate pass)', () => {
  const tenantQuery = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'gatePasses'), where('tenantId', '==', A)))
  const ids = (snap: Awaited<ReturnType<typeof tenantQuery>>) => snap.docs.map((d) => d.id).sort()

  it('the admin and the Safety Officer read every pass of their company, and nothing of another', async () => {
    for (const db of [adminA(), safetyA()]) {
      expect(ids(await assertSucceeds(tenantQuery(db)))).toEqual(['2026-03_veh_a1_drvA1', '2026-03_veh_a2_drvA2'])
      await assertSucceeds(getDoc(doc(db, 'gatePasses', '2026-03_veh_a2_drvA2')))
      await assertFails(getDoc(doc(db, 'gatePasses', '2026-03_veh_b1_drvB1')))
      await assertFails(getDocs(query(collection(db, 'gatePasses'), where('tenantId', '==', B))))
    }
  })

  it('a supervisor reads only their own contractor’s passes; the query must carry the contractor', async () => {
    const db = supA1()
    expect(ids(await assertSucceeds(getDocs(query(collection(db, 'gatePasses'), where('tenantId', '==', A), where('contractorId', '==', 'c1')))))).toEqual(['2026-03_veh_a1_drvA1'])
    await assertSucceeds(getDoc(doc(db, 'gatePasses', '2026-03_veh_a1_drvA1')))
    await assertFails(getDoc(doc(db, 'gatePasses', '2026-03_veh_a2_drvA2')))
    await assertFails(tenantQuery(db))
  })

  it('security, officer, drivers, the Yard Officer and signed-out users cannot read passes at all (the check-in function consumes them)', async () => {
    for (const db of [securityA(), officerA(), drvA1(), yardA(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'gatePasses', '2026-03_veh_a1_drvA1')))
      await assertFails(tenantQuery(db))
    }
  })

  it('nobody writes: not even the admin (issue, block and reactivate are callables)', async () => {
    for (const db of [adminA(), safetyA(), supA1(), securityA(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'gatePasses', 'x'), { tenantId: A, status: 'active', contractorId: 'c1' }))
      await assertFails(addDoc(collection(db, 'gatePasses'), { tenantId: A, status: 'active', contractorId: 'c1' }))
      await assertFails(updateDoc(doc(db, 'gatePasses', '2026-03_veh_a1_drvA1'), { status: 'active', blockedReason: null }))
      await assertFails(updateDoc(doc(db, 'gatePasses', '2026-03_veh_a1_drvA1'), { status: 'blocked' }))
      await assertFails(deleteDoc(doc(db, 'gatePasses', '2026-03_veh_a1_drvA1')))
    }
  })
})

describe('monthEndQualification', () => {
  it('only the admin reads the list and its entries, of their own company', async () => {
    const db = adminA()
    await assertSucceeds(getDoc(doc(db, 'monthEndQualification', `${A}_2026-04`)))
    await assertSucceeds(getDocs(query(collection(db, 'monthEndQualification', `${A}_2026-04`, 'entries'), where('tenantId', '==', A))))
    await assertFails(getDoc(doc(db, 'monthEndQualification', `${B}_2026-04`)))
    await assertFails(getDocs(query(collection(db, 'monthEndQualification', `${B}_2026-04`, 'entries'), where('tenantId', '==', B))))
  })

  it('a list that was not computed yet reads as missing for the admin of that company, not as denied', async () => {
    const snap = await assertSucceeds(getDoc(doc(adminA(), 'monthEndQualification', `${A}_2031-01`)))
    expect(snap.exists()).toBe(false)
    await assertFails(getDoc(doc(adminA(), 'monthEndQualification', `${B}_2031-01`)))
  })

  it('every other role is denied, entries included', async () => {
    for (const db of [safetyA(), supA1(), securityA(), officerA(), drvA1(), yardA(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'monthEndQualification', `${A}_2026-04`)))
      await assertFails(getDocs(query(collection(db, 'monthEndQualification'), where('tenantId', '==', A))))
      await assertFails(getDocs(query(collection(db, 'monthEndQualification', `${A}_2026-04`, 'entries'), where('tenantId', '==', A))))
    }
  })

  it('nobody writes, the admin included', async () => {
    for (const db of [adminA(), safetyA()]) {
      await assertFails(setDoc(doc(db, 'monthEndQualification', `${A}_2026-05`), { tenantId: A }))
      await assertFails(updateDoc(doc(db, 'monthEndQualification', `${A}_2026-04`), { qualifiedCount: 99 }))
      await assertFails(setDoc(doc(db, 'monthEndQualification', `${A}_2026-04`, 'entries', 'x'), { tenantId: A }))
      await assertFails(deleteDoc(doc(db, 'monthEndQualification', `${A}_2026-04`, 'entries', 'veh_a1_drvA1')))
    }
  })
})

describe('visits', () => {
  const tenantQuery = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'visits'), where('tenantId', '==', A)))
  const activeQuery = (db: ReturnType<typeof adminA>) => getDocs(query(collection(db, 'visits'), where('tenantId', '==', A), where('status', '==', 'checked_in')))
  const ids = (snap: Awaited<ReturnType<typeof tenantQuery>>) => snap.docs.map((d) => d.id).sort()

  it('admin, officer, Safety Officer and security read every visit of their company, and nothing of another', async () => {
    for (const db of [adminA(), officerA(), safetyA(), securityA()]) {
      expect(ids(await assertSucceeds(tenantQuery(db)))).toEqual(['vis_a1', 'vis_a1_out', 'vis_a2'])
      await assertSucceeds(getDoc(doc(db, 'visits', 'vis_a2')))
      await assertFails(getDoc(doc(db, 'visits', 'vis_b1')))
      await assertFails(getDocs(query(collection(db, 'visits'), where('tenantId', '==', B))))
    }
  })

  it('security can find the active visit of a vehicle (check-out by scan)', async () => {
    const q = query(collection(securityA(), 'visits'), where('tenantId', '==', A), where('vehicleId', '==', 'veh_a1'), where('status', '==', 'checked_in'))
    expect(ids(await assertSucceeds(getDocs(q)))).toEqual(['vis_a1', 'vis_a2'])
  })

  it('a supervisor reads only their own contractor’s visits; the query must carry the contractor', async () => {
    const db = supA1()
    expect(ids(await assertSucceeds(getDocs(query(collection(db, 'visits'), where('tenantId', '==', A), where('contractorId', '==', 'c1')))))).toEqual(['vis_a1', 'vis_a1_out'])
    await assertSucceeds(getDoc(doc(db, 'visits', 'vis_a1')))
    await assertFails(getDoc(doc(db, 'visits', 'vis_a2')))
    await assertFails(tenantQuery(db))
  })

  it('the Yard Officer reads visits that are still checked in, and never one that has left', async () => {
    const db = yardA()
    expect(ids(await assertSucceeds(activeQuery(db)))).toEqual(['vis_a1', 'vis_a2'])
    await assertSucceeds(getDoc(doc(db, 'visits', 'vis_a1')))
    await assertFails(getDoc(doc(db, 'visits', 'vis_a1_out')))
    await assertFails(tenantQuery(db))
    await assertFails(getDoc(doc(db, 'visits', 'vis_b1')))
  })

  it('the Yard Officer reads nothing else that belongs to the tenant', async () => {
    const db = yardA()
    await assertFails(getDocs(query(collection(db, 'penalties'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'inspections'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'users'), where('tenantId', '==', A))))
    await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A))))
  })

  it('drivers and signed-out users have no access: security checks them in and out', async () => {
    for (const db of [drvA1(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'visits', 'vis_a1')))
      await assertFails(tenantQuery(db))
      await assertFails(activeQuery(db))
    }
  })

  it('nobody writes a visit from a client, the Yard Officer and security included (callables only)', async () => {
    for (const db of [adminA(), officerA(), safetyA(), supA1(), securityA(), yardA(), drvA1()]) {
      await assertFails(addDoc(collection(db, 'visits'), { tenantId: A, contractorId: 'c1', status: 'checked_in' }))
      await assertFails(setDoc(doc(db, 'visits', 'vis_new'), { tenantId: A, contractorId: 'c1', status: 'checked_in' }))
      await assertFails(updateDoc(doc(db, 'visits', 'vis_a1'), { unloadingCheck: { performed: true, unloaded: true } }))
      await assertFails(updateDoc(doc(db, 'visits', 'vis_a1'), { status: 'checked_out', driverOnDutyLock: false }))
      await assertFails(updateDoc(doc(db, 'visits', 'vis_a1'), { dwellWarning: true }))
      await assertFails(deleteDoc(doc(db, 'visits', 'vis_a1')))
    }
  })

  it('the driver lock on the driver record is not writable by anyone', async () => {
    for (const db of [adminA(), securityA(), yardA(), supA1(), drvA1()]) {
      await assertFails(updateDoc(doc(db, 'drivers', 'drvA1'), { driverOnDutyLock: false }))
    }
  })
})
