import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { doc, setDoc } from 'firebase/firestore'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'
import { afterAll, beforeAll, describe, it } from 'vitest'

const A = 'tenantA'
const B = 'tenantB'
const path = (tenant: string, contractor: string, uid: string, ext = 'jpg') =>
  `tenants/${tenant}/contractors/${contractor}/drivers/${uid}.${ext}`

let env: RulesTestEnvironment

const DAY = '20260310'
const evidence = (tenant: string, vehicleId: string, attempt: number | string, file: string, day = DAY) =>
  `tenants/${tenant}/passes/${vehicleId}/${day}/${attempt}/${file}`

const penaltyPhoto = (tenant: string, pid: string, file = 'evidence.jpg') => `tenants/${tenant}/penalties/${pid}/${file}`

const jpeg = (bytes = 1000) => new Uint8Array(bytes).fill(7)
const JPEG = { contentType: 'image/jpeg' }

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-conveypass-rules',
    storage: { rules: readFileSync('storage.rules', 'utf8') },
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
  await env.withSecurityRulesDisabled(async (ctx) => {
    // Vehicles and passes the evidence rules look up (storage rules use firestore.get).
    const db = ctx.firestore()
    const vehicle = (tenantId: string, contractorId: string, assignedDriverIds: string[]) => ({
      tenantId, contractorId, assignedDriverIds, plateNo: 'X', plateKey: 'X', type: 'Tipper', status: 'active',
    })
    await setDoc(doc(db, 'vehicles', 'veh_open'), vehicle(A, 'c1', ['drvA1']))
    await setDoc(doc(db, 'vehicles', 'veh_shared'), vehicle(A, 'c1', ['drvA1', 'drvA1b']))
    await setDoc(doc(db, 'vehicles', 'veh_other'), vehicle(A, 'c2', ['drvA2']))
    await setDoc(doc(db, 'vehicles', 'veh_sub'), vehicle(A, 'c1', ['drvA1']))
    await setDoc(doc(db, 'vehicles', 'veh_rej'), vehicle(A, 'c1', ['drvA1', 'drvA1b']))
    await setDoc(doc(db, 'vehicles', 'veh_b'), vehicle(B, 'cB', ['drvB1']))
    await setDoc(doc(db, 'penalties', 'pen_issued0001'), { tenantId: A, contractorId: 'c1', status: 'active' })
    await setDoc(doc(db, 'penalties', 'pen_issued0002'), { tenantId: A, contractorId: 'c2', status: 'active' })
    await setDoc(doc(db, 'penalties', 'pen_issuedbbbb'), { tenantId: B, contractorId: 'cB', status: 'active' })
    await setDoc(doc(db, 'passes', `veh_sub_${DAY}`), { tenantId: A, contractorId: 'c1', driverId: 'drvA1', status: 'submitted', attempt: 1 })
    await setDoc(doc(db, 'passes', `veh_rej_${DAY}`), { tenantId: A, contractorId: 'c1', driverId: 'drvA1', status: 'rejected', attempt: 1 })
    const storage = ctx.storage()
    for (const p of [evidence(A, 'veh_open', 1, 'gps.jpg'), evidence(A, 'veh_other', 1, 'gps.jpg'), evidence(A, 'veh_sub', 1, 'gps.jpg'), evidence(B, 'veh_b', 1, 'gps.jpg')]) {
      await uploadBytes(ref(storage, p), jpeg(), JPEG)
    }
    for (const p of [penaltyPhoto(A, 'pen_issued0001'), penaltyPhoto(A, 'pen_issued0002'), penaltyPhoto(B, 'pen_issuedbbbb')]) {
      await uploadBytes(ref(storage, p), jpeg(), JPEG)
    }
    for (const p of [path(A, 'c1', 'drvA1'), path(A, 'c1', 'drvA1b'), path(A, 'c2', 'drvA2'), path(B, 'cB', 'drvB1')]) {
      await uploadBytes(ref(storage, p), jpeg(), JPEG)
    }
  })
})
afterAll(async () => {
  await env.cleanup()
})

const as = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims).storage()
const adminA = () => as('adminA', { role: 'admin', tenantId: A })
const supA1 = () => as('supA1', { role: 'supervisor', tenantId: A, contractorId: 'c1' })
const supA2 = () => as('supA2', { role: 'supervisor', tenantId: A, contractorId: 'c2' })
const drvA1 = () => as('drvA1', { role: 'driver', tenantId: A, contractorId: 'c1' })
const drvA1b = () => as('drvA1b', { role: 'driver', tenantId: A, contractorId: 'c1' })
const drvA2 = () => as('drvA2', { role: 'driver', tenantId: A, contractorId: 'c2' })
const safetyA = () => as('safA', { role: 'safety', tenantId: A })
const officerA = () => as('offA', { role: 'officer', tenantId: A })
const securityA = () => as('secA', { role: 'security', tenantId: A })

describe('driver photos: read', () => {
  it('admin, officer and security read any photo in their tenant', async () => {
    for (const s of [adminA(), officerA(), securityA()]) {
      await assertSucceeds(getBytes(ref(s, path(A, 'c1', 'drvA1'))))
      await assertSucceeds(getBytes(ref(s, path(A, 'c2', 'drvA2'))))
    }
  })
  it('supervisor reads their contractor’s photos only', async () => {
    await assertSucceeds(getBytes(ref(supA1(), path(A, 'c1', 'drvA1b'))))
    await assertFails(getBytes(ref(supA1(), path(A, 'c2', 'drvA2'))))
  })
  it('a driver reads only their own photo', async () => {
    await assertSucceeds(getBytes(ref(drvA1(), path(A, 'c1', 'drvA1'))))
    await assertFails(getBytes(ref(drvA1(), path(A, 'c1', 'drvA1b'))))
    await assertFails(getBytes(ref(drvA1(), path(A, 'c2', 'drvA2'))))
  })
  it('denies cross-tenant and signed-out reads', async () => {
    for (const s of [adminA(), officerA(), supA1(), drvA1()]) await assertFails(getBytes(ref(s, path(B, 'cB', 'drvB1'))))
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path(A, 'c1', 'drvA1'))))
    await assertFails(getBytes(ref(as('x', {}), path(A, 'c1', 'drvA1'))))
  })
})

describe('driver photos: the gate (Module 5)', () => {
  it('security reads every driver photo of the tenant (to compare faces), never another tenant’s, and cannot write', async () => {
    for (const p of [path(A, 'c1', 'drvA1'), path(A, 'c2', 'drvA2')]) await assertSucceeds(getBytes(ref(securityA(), p)))
    await assertFails(getBytes(ref(securityA(), path(B, 'cB', 'drvB1'))))
    await assertFails(getBytes(ref(as('secB', { role: 'security', tenantId: B }), path(A, 'c1', 'drvA1'))))
    await assertFails(uploadBytes(ref(securityA(), path(A, 'c1', 'drvA1')), jpeg(), JPEG))
    await assertFails(deleteObject(ref(securityA(), path(A, 'c1', 'drvA1'))))
  })
})

describe('driver photos: write', () => {
  it('admin and the contractor’s supervisor can upload a JPEG under 1 MB', async () => {
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c1', 'newDrv1')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c2', 'newDrv2')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(supA1(), path(A, 'c1', 'newDrv3')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(supA1(), path(A, 'c1', 'drvA1')), jpeg(), JPEG)) // replace
  })
  it('a supervisor cannot write to another contractor’s folder', async () => {
    await assertFails(uploadBytes(ref(supA2(), path(A, 'c1', 'newDrv4')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(supA1(), path(A, 'c2', 'newDrv5')), jpeg(), JPEG))
  })
  it('nobody else can write, including the driver themselves', async () => {
    for (const s of [officerA(), securityA(), drvA1()]) {
      await assertFails(uploadBytes(ref(s, path(A, 'c1', 'newDrv6')), jpeg(), JPEG))
      await assertFails(uploadBytes(ref(s, path(A, 'c1', 'drvA1')), jpeg(), JPEG))
    }
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path(A, 'c1', 'newDrv7')), jpeg(), JPEG))
  })
  it('denies cross-tenant writes', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(B, 'cB', 'newDrv8')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(as('adminB', { role: 'admin', tenantId: B }), path(A, 'c1', 'newDrv9')), jpeg(), JPEG))
  })
  it('enforces content type', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct1')), jpeg(), { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct2')), jpeg(), { contentType: 'text/html' }))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct3')), jpeg()))
  })
  it('enforces the 1 MB limit', async () => {
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c1', 'size1')), jpeg(1024 * 1024 - 1), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'size2')), jpeg(1024 * 1024), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'size3')), jpeg(2 * 1024 * 1024), JPEG))
  })
  it('enforces the {uid}.jpg file name', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'x', 'png')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'x', 'jpeg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'a.b')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', '..%2Fx')), jpeg(), JPEG))
  })
  it('never deletes from the client', async () => {
    await assertFails(deleteObject(ref(adminA(), path(A, 'c1', 'drvA1'))))
    await assertFails(deleteObject(ref(supA1(), path(A, 'c1', 'drvA1'))))
  })
})

describe('everything else stays denied', () => {
  it('other paths, depths and tenants', async () => {
    const s = adminA()
    await assertFails(uploadBytes(ref(s, 'misc/photo.jpg'), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/photo.jpg`), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/contractors/c1/logo.jpg`), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/contractors/c1/drivers/sub/x.jpg`), jpeg(), JPEG))
    await assertFails(getBytes(ref(s, 'misc/photo.jpg')))
  })
})

describe('pass evidence: driver upload', () => {
  const PNG = { contentType: 'image/png' }
  it('an assigned driver can upload the four allowed files for attempt 1..5 of a new pass', async () => {
    for (const f of ['gps.jpg', 'dashcam.jpg', 'extra1.jpg', 'extra2.jpg']) {
      await assertSucceeds(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, f)), jpeg(50_000), JPEG))
    }
    await assertSucceeds(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'gps.jpg')), jpeg(60_000), JPEG)) // retake before submit
  })
  it('a driver not assigned to the vehicle cannot upload', async () => {
    await assertFails(uploadBytes(ref(drvA1b(), evidence(A, 'veh_open', 1, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_other', 1, 'dashcam.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_missing', 1, 'gps.jpg')), jpeg(), JPEG))
  })
  it('cross-tenant uploads are denied', async () => {
    await assertFails(uploadBytes(ref(drvA1(), evidence(B, 'veh_b', 1, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(B, 'veh_open', 1, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(as('drvB1', { role: 'driver', tenantId: B, contractorId: 'cB' }), evidence(A, 'veh_open', 1, 'gps.jpg')), jpeg(), JPEG))
  })
  it('only the allowed file names', async () => {
    for (const f of ['extra3.jpg', 'gps.png', 'other.jpg', 'gps.jpeg', 'GPS.jpg']) {
      await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, f)), jpeg(), JPEG))
    }
  })
  it('only attempts 1 to 5, and a bad dateKey is denied', async () => {
    for (const a of [0, 6, 10, '01', 'x']) {
      await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', a, 'gps.jpg')), jpeg(), JPEG))
    }
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'gps.jpg', '2026-03-10')), jpeg(), JPEG))
  })
  it('only JPEG, and under 700 KB', async () => {
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'dashcam.jpg')), jpeg(), PNG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'dashcam.jpg')), jpeg()))
    await assertSucceeds(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'dashcam.jpg')), jpeg(700 * 1024 - 1), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'dashcam.jpg')), jpeg(700 * 1024), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'dashcam.jpg')), jpeg(2 * 1024 * 1024), JPEG))
  })
  it('is locked once the pass is submitted (not rejected)', async () => {
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_sub', 1, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_sub', 2, 'gps.jpg')), jpeg(), JPEG))
  })
  it('after a rejection, only the same driver can upload, only for the next attempt', async () => {
    await assertSucceeds(uploadBytes(ref(drvA1(), evidence(A, 'veh_rej', 2, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_rej', 1, 'gps.jpg')), jpeg(), JPEG)) // never overwrite earlier evidence
    await assertFails(uploadBytes(ref(drvA1(), evidence(A, 'veh_rej', 3, 'gps.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(drvA1b(), evidence(A, 'veh_rej', 2, 'gps.jpg')), jpeg(), JPEG))
  })
  it('staff and signed-out users cannot upload evidence', async () => {
    for (const s of [adminA(), supA1(), officerA(), securityA(), env.unauthenticatedContext().storage()]) {
      await assertFails(uploadBytes(ref(s, evidence(A, 'veh_open', 1, 'extra1.jpg')), jpeg(), JPEG))
    }
  })
  it('nobody can delete evidence', async () => {
    for (const s of [drvA1(), adminA(), supA1(), officerA()]) {
      await assertFails(deleteObject(ref(s, evidence(A, 'veh_open', 1, 'gps.jpg'))))
      await assertFails(deleteObject(ref(s, evidence(A, 'veh_sub', 1, 'gps.jpg'))))
    }
  })
})

describe('pass evidence: read', () => {
  it('admin, officer and security read the tenant’s evidence', async () => {
    for (const s of [adminA(), officerA(), securityA()]) await assertSucceeds(getBytes(ref(s, evidence(A, 'veh_open', 1, 'gps.jpg'))))
  })
  it('a supervisor reads only their contractor’s evidence', async () => {
    await assertSucceeds(getBytes(ref(supA1(), evidence(A, 'veh_open', 1, 'gps.jpg'))))
    await assertFails(getBytes(ref(supA1(), evidence(A, 'veh_other', 1, 'gps.jpg'))))
    await assertSucceeds(getBytes(ref(supA2(), evidence(A, 'veh_other', 1, 'gps.jpg'))))
    await assertFails(getBytes(ref(supA2(), evidence(A, 'veh_open', 1, 'gps.jpg'))))
  })
  it('earlier attempts and other days stay readable by the same people (evidence is never overwritten)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [attempt, day] of [[2, DAY], [1, '20260309']] as const) {
        await uploadBytes(ref(ctx.storage(), evidence(A, 'veh_open', attempt, 'dashcam.jpg', day)), jpeg(), JPEG)
      }
    })
    for (const s of [adminA(), officerA(), supA1(), drvA1()]) {
      await assertSucceeds(getBytes(ref(s, evidence(A, 'veh_open', 2, 'dashcam.jpg'))))
      await assertSucceeds(getBytes(ref(s, evidence(A, 'veh_open', 1, 'dashcam.jpg', '20260309'))))
    }
    await assertFails(getBytes(ref(supA2(), evidence(A, 'veh_open', 2, 'dashcam.jpg'))))
    await assertFails(getBytes(ref(supA2(), evidence(A, 'veh_open', 1, 'dashcam.jpg', '20260309'))))
  })
  it('approving or rejecting does not open evidence to writes: officers and supervisors cannot upload', async () => {
    for (const s of [supA1(), officerA(), adminA()]) {
      await assertFails(uploadBytes(ref(s, evidence(A, 'veh_open', 1, 'extra1.jpg')), jpeg(), JPEG))
    }
  })
  it('a driver reads evidence only for vehicles they are assigned to', async () => {
    await assertSucceeds(getBytes(ref(drvA1(), evidence(A, 'veh_open', 1, 'gps.jpg'))))
    await assertFails(getBytes(ref(drvA1(), evidence(A, 'veh_other', 1, 'gps.jpg'))))
    await assertFails(getBytes(ref(drvA2(), evidence(A, 'veh_open', 1, 'gps.jpg'))))
  })
  it('cross-tenant and signed-out reads are denied', async () => {
    for (const s of [adminA(), officerA(), securityA(), supA1(), drvA1()]) await assertFails(getBytes(ref(s, evidence(B, 'veh_b', 1, 'gps.jpg'))))
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), evidence(A, 'veh_open', 1, 'gps.jpg'))))
  })
})

describe('platform operators (Module 9)', () => {
  const operator = () => as('op1', { role: 'platform', platformAdmin: true, email_verified: true })
  it('an operator token (no tenantId) can read and write no Storage path, driver photos and pass evidence included', async () => {
    const s = operator()
    for (const p of [path(A, 'c1', 'drvA1'), path(B, 'cB', 'drvB1'), evidence(A, 'veh_open', 1, 'gps.jpg'), evidence(B, 'veh_b', 1, 'gps.jpg')]) {
      await assertFails(getBytes(ref(s, p)))
      await assertFails(uploadBytes(ref(s, p), jpeg(), JPEG))
      await assertFails(deleteObject(ref(s, p)))
    }
    await assertFails(uploadBytes(ref(s, evidence(A, 'veh_open', 1, 'extra2.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, 'tenants/tenantNew/anything.jpg'), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, 'operators/op1.jpg'), jpeg(), JPEG))
  })
})

describe('penalty evidence', () => {
  it('admin and Safety Officer upload a photo for a penalty that does not exist yet, once', async () => {
    for (const [s, pid] of [[adminA(), 'pen_newadmin01'], [safetyA(), 'pen_newsafety1']] as const) {
      await assertSucceeds(uploadBytes(ref(s, penaltyPhoto(A, pid)), jpeg(), JPEG))
      await assertFails(uploadBytes(ref(s, penaltyPhoto(A, pid)), jpeg(), JPEG)) // create only: no replacing
    }
  })

  it('refuses everything else: other roles, other tenants, issued penalties, wrong file, type, size, id shape, delete', async () => {
    for (const s of [supA1(), officerA(), securityA(), drvA1()]) await assertFails(uploadBytes(ref(s, penaltyPhoto(A, 'pen_nobody0001')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), penaltyPhoto(B, 'pen_crosstenan')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(safetyA(), penaltyPhoto(A, 'pen_issued0001')), jpeg(), JPEG)) // already issued
    await assertFails(uploadBytes(ref(safetyA(), penaltyPhoto(A, 'pen_wrongfile1', 'other.jpg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(safetyA(), penaltyPhoto(A, 'pen_wrongtype1')), jpeg(), { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(safetyA(), penaltyPhoto(A, 'pen_toolarge01')), jpeg(800 * 1024), JPEG))
    await assertFails(uploadBytes(ref(safetyA(), penaltyPhoto(A, 'bad-id')), jpeg(), JPEG))
    await assertFails(deleteObject(ref(adminA(), penaltyPhoto(A, 'pen_issued0001'))))
    await assertFails(deleteObject(ref(safetyA(), penaltyPhoto(A, 'pen_issued0001'))))
  })

  it('is read by the company’s admin and Safety Officers, and by the supervisor of that contractor only', async () => {
    await assertSucceeds(getBytes(ref(adminA(), penaltyPhoto(A, 'pen_issued0002'))))
    await assertSucceeds(getBytes(ref(safetyA(), penaltyPhoto(A, 'pen_issued0001'))))
    await assertSucceeds(getBytes(ref(supA1(), penaltyPhoto(A, 'pen_issued0001'))))
    await assertFails(getBytes(ref(supA1(), penaltyPhoto(A, 'pen_issued0002')))) // another contractor
    await assertFails(getBytes(ref(supA2(), penaltyPhoto(A, 'pen_issued0001'))))
  })

  it('is never read by security, officers, drivers, other companies or signed-out users', async () => {
    for (const s of [securityA(), officerA(), drvA1(), env.unauthenticatedContext().storage()]) await assertFails(getBytes(ref(s, penaltyPhoto(A, 'pen_issued0001'))))
    for (const s of [adminA(), safetyA(), supA1()]) await assertFails(getBytes(ref(s, penaltyPhoto(B, 'pen_issuedbbbb'))))
    await assertFails(getBytes(ref(as('safB', { role: 'safety', tenantId: B }), penaltyPhoto(A, 'pen_issued0001'))))
  })
})
