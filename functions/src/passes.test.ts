import { beforeEach, describe, expect, it } from 'vitest'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { evidenceFolder, expectedAttempt, planSubmit, validateChecklist } from './passRules.js'
import { passIdFor, resolveVehicle, submitPass, updateTenantSettings } from './passes.js'
import { admin, caller, drv1, drv1b, makeWorld, NOW, rejects, sup1, userDoc, type World } from './test-utils.js'
import type { PassData, StoredFile, VehicleData } from './types.js'

const VID = 'veh_aaaaaaaaaa'
const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const PASS_ID = `${VID}_${DAY}`

const veh = () => w.vehicles.get(VID) as VehicleData

let w: World
beforeEach(() => {
  w = makeWorld()
  w.users.set('drv1b', userDoc({ contractorId: 'C1', phone: '94770000011' }))
  w.vehicles.set(VID, {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper',
    assignedDriverIds: ['drv1', 'drv1b'], status: 'active',
  })
  w.vehicles.set('veh_bbbbbbbbbb', {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'CAB-1', plateKey: 'CAB1', type: 'Tipper',
    assignedDriverIds: [], status: 'active',
  })
})

const jpeg = (over: Partial<StoredFile> = {}): StoredFile => ({
  contentType: 'image/jpeg', size: 50 * 1024, timeCreated: NOW * 1000 - 60_000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), ...over,
})
const putFiles = (attempt = 1, names = ['gps.jpg', 'dashcam.jpg'], over: Partial<StoredFile> = {}, vehicleId = VID) => {
  for (const n of names) w.files.set(`${evidenceFolder('T1', vehicleId, DAY, attempt)}${n}`, jpeg(over))
}
const answers = (over: Record<string, { answer: 'yes' | 'no'; note?: string }> = {}) =>
  DEFAULT_CHECKLIST.map((c) => ({ id: c.id, answer: 'yes' as const, ...over[c.id] }))
const body = (over: Record<string, unknown> = {}) => ({
  vehicleId: VID, attempt: 1, checklist: answers(), extraCount: 0,
  captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' } },
  ...over,
})
const submit = (c = drv1(), over: Record<string, unknown> = {}) => submitPass(w.deps, c, body(over))
const resolve = (c = drv1(), vehicleId = VID) => resolveVehicle(w.deps, c, { vehicleId })

const seedPass = (over: Partial<PassData> = {}): PassData => {
  const p: PassData = {
    tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'WP LJ-4821', vehicleType: 'Tipper', dateKey: DAY,
    driverId: 'drv1', driverName: 'Name', status: 'submitted', attempt: 1, submittedAt: NOW * 1000 - 5000,
    checklist: [{ id: 'dashcam_recording', label: 'Dashcam is recording', answer: 'no', note: 'Lens loose' }],
    evidence: {
      gps: { path: 'p/gps.jpg', size: 1, contentType: 'image/jpeg' },
      dashcam: { path: 'p/dashcam.jpg', size: 1, contentType: 'image/jpeg' },
      extra: [],
    },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    ...over,
  }
  w.passes.set(PASS_ID, p)
  return p
}
const rejected = (over: Partial<PassData> = {}) =>
  seedPass({ status: 'rejected', rejection: { reason: 'Dashcam not visible', reasonCode: 'dashcam_unclear', stage: 'supervisor', byUid: 'sup1', byName: 'Sup', byRole: 'supervisor', at: NOW * 1000 - 1000 }, ...over })

describe('resolveVehicle', () => {
  it('returns can_submit with the default checklist, settings and today’s dateKey', async () => {
    const r = await resolve()
    expect(r).toMatchObject({
      state: 'can_submit', attempt: 1, dateKey: DAY,
      vehicle: { id: VID, plateNo: 'WP LJ-4821', type: 'Tipper' },
      passSettings: { requireLocation: false, maxExtraPhotos: 2 },
    })
    if (r.state === 'can_submit') expect(r.checklist.map((c) => c.id)).toEqual(DEFAULT_CHECKLIST.map((c) => c.id))
  })
  it('uses the tenant checklist and settings when configured', async () => {
    w.tenants.set('T1', {
      timezone: 'Asia/Colombo', passSettings: { requireLocation: true, maxExtraPhotos: 1 },
      checklist: [{ id: 'tyres', label: 'Tyres are fine', failBlocks: true }],
    })
    const r = await resolve()
    expect(r).toMatchObject({ state: 'can_submit', passSettings: { requireLocation: true, maxExtraPhotos: 1 } })
    if (r.state === 'can_submit') expect(r.checklist).toEqual([{ id: 'tyres', label: 'Tyres are fine', failBlocks: true }])
  })
  it('uses the tenant timezone for the day', async () => {
    w.tenants.set('T1', { timezone: 'America/Los_Angeles' })
    const r = await resolve()
    expect(r).toMatchObject({ state: 'can_submit', dateKey: '20231114' })
  })
  it('not_assigned reveals nothing else', async () => {
    expect(await resolve(drv1(), 'veh_bbbbbbbbbb')).toEqual({ state: 'not_assigned' })
  })
  it('not_found for unknown ids, malformed ids and other tenants’ vehicles', async () => {
    w.vehicles.set('veh_cccccccccc', { ...veh(), tenantId: 'T2', contractorId: 'CX' })
    for (const id of ['veh_zzzzzzzzzz', 'nope', '', 'veh_cccccccccc']) expect(await resolve(drv1(), id)).toEqual({ state: 'not_found' })
  })
  it('vehicle_suspended and contractor_suspended', async () => {
    w.vehicles.set(VID, { ...veh(), status: 'suspended' })
    expect(await resolve()).toEqual({ state: 'vehicle_suspended' })
    w.vehicles.set(VID, { ...veh(), status: 'active' })
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    expect(await resolve()).toEqual({ state: 'contractor_suspended' })
  })
  it('is for drivers only', async () => {
    for (const c of [admin(), sup1(), caller('officer', 'officer'), caller('sec', 'security')]) {
      await rejects(resolve(c), 'permission-denied', 'forbidden')
    }
  })
  it('rejects a disabled driver and a forged caller', async () => {
    w.users.set('drv1', userDoc({ status: 'disabled' }))
    await rejects(resolve(), 'permission-denied', 'caller-not-active')
  })
  it('shows an existing pass to anyone assigned, with who submitted it', async () => {
    seedPass()
    expect(await resolve(drv1b())).toEqual({
      state: 'pending', pass: { passId: PASS_ID, plateNo: 'WP LJ-4821', status: 'submitted', submittedAt: NOW * 1000 - 5000, driverName: 'Name', mine: false },
    })
    seedPass({ status: 'supervisor_approved' })
    expect(await resolve()).toMatchObject({ state: 'pending', pass: { mine: true } })
    seedPass({ status: 'officer_approved' })
    expect((await resolve()).state).toBe('approved')
    seedPass({ status: 'checked_in' })
    expect((await resolve()).state).toBe('checked_in')
  })
  it('can_resubmit for the same driver, with the reason and previous answers', async () => {
    rejected()
    const r = await resolve()
    expect(r).toMatchObject({
      state: 'can_resubmit', attempt: 2, rejection: { reason: 'Dashcam not visible', at: NOW * 1000 - 1000 },
      previous: { attempt: 1, checklist: [{ id: 'dashcam_recording', answer: 'no' }] },
    })
  })
  it('rejected_locked for another driver, and after the last attempt', async () => {
    rejected()
    expect(await resolve(drv1b())).toMatchObject({ state: 'rejected_locked', reason: 'other_driver' })
    rejected({ attempt: 5 })
    expect(await resolve()).toMatchObject({ state: 'rejected_locked', reason: 'max_attempts' })
  })
})

describe('submitPass', () => {
  it('creates a submitted pass with server-derived fields, evidence metadata and an audit entry', async () => {
    putFiles(1, ['gps.jpg', 'dashcam.jpg', 'extra1.jpg'])
    const res = await submit(drv1(), { extraCount: 1, captureMeta: { method: 'file', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' }, location: { lat: 6.9, lng: 79.8, accuracy: 12 } } })
    expect(res).toEqual({ passId: PASS_ID, status: 'submitted', attempt: 1 })
    const p = w.passes.get(PASS_ID) as PassData
    expect(p).toMatchObject({
      tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'WP LJ-4821', vehicleType: 'Tipper',
      dateKey: DAY, driverId: 'drv1', driverName: 'Name', status: 'submitted', attempt: 1,
      captureMeta: { method: 'file', location: { lat: 6.9, lng: 79.8, accuracy: 12 } },
    })
    expect(p.evidence.gps).toEqual({ path: `tenants/T1/passes/${VID}/${DAY}/1/gps.jpg`, size: 50 * 1024, contentType: 'image/jpeg' })
    expect(p.evidence.extra).toHaveLength(1)
    expect(p.checklist.map((c) => c.label)).toEqual(DEFAULT_CHECKLIST.map((c) => c.label))
    expect(w.audits.at(-1)).toMatchObject({ action: 'pass.submit', targetType: 'pass', targetId: PASS_ID, actorUid: 'drv1' })
  })

  it('ignores client-provided identity fields', async () => {
    putFiles()
    await submit(drv1(), { tenantId: 'T2', contractorId: 'C2', plateNo: 'FAKE', driverName: 'Mallory', dateKey: '19990101' })
    expect(w.passes.get(PASS_ID)).toMatchObject({ tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', driverName: 'Name' })
  })

  it('rejects non-drivers', async () => {
    putFiles()
    for (const c of [admin(), sup1()]) await rejects(submit(c), 'permission-denied', 'forbidden')
    expect(w.passes.size).toBe(0)
  })
  it('rejects a vehicle that is not assigned', async () => {
    putFiles(1, undefined, {}, 'veh_bbbbbbbbbb')
    await rejects(submit(drv1(), { vehicleId: 'veh_bbbbbbbbbb' }), 'permission-denied', 'not-assigned')
  })
  it('rejects suspended vehicle and suspended contractor', async () => {
    putFiles()
    w.vehicles.set(VID, { ...veh(), status: 'suspended' })
    await rejects(submit(), 'failed-precondition', 'vehicle-suspended')
    w.vehicles.set(VID, { ...veh(), status: 'active' })
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(submit(), 'failed-precondition', 'contractor-suspended')
  })
  it('rejects a vehicle of another tenant as not found', async () => {
    w.vehicles.set('veh_cccccccccc', { ...veh(), tenantId: 'T2' })
    await rejects(submit(drv1(), { vehicleId: 'veh_cccccccccc' }), 'not-found', 'vehicle-not-found')
  })

  it('a second submission the same day is rejected, by the same and by another driver', async () => {
    putFiles()
    await submit()
    await rejects(submit(), 'already-exists', 'pass-exists')
    await rejects(submit(drv1b()), 'already-exists', 'pass-exists')
    expect(w.passes.size).toBe(1)
  })

  it('rejected -> resubmit increments the attempt, keeps the reason, old evidence and old answers', async () => {
    const before = rejected()
    putFiles(2)
    const res = await submit(drv1(), { attempt: 2 })
    expect(res).toMatchObject({ passId: PASS_ID, attempt: 2, status: 'submitted' })
    const p = w.passes.get(PASS_ID) as PassData
    expect(p.status).toBe('submitted')
    expect(p.attempt).toBe(2)
    expect(p.rejection).toBeUndefined()
    expect(p.rejectionHistory).toEqual([
      expect.objectContaining({ attempt: 1, reason: 'Dashcam not visible', byUid: 'sup1', checklist: before.checklist, evidence: before.evidence }),
    ])
    expect(p.evidence.gps.path).toContain('/2/gps.jpg')
    expect(w.audits.at(-1)).toMatchObject({ action: 'pass.resubmit' })
  })
  it('a second rejection appends to the history', async () => {
    rejected({ attempt: 2, rejectionHistory: [{ reason: 'first', reasonCode: 'other', stage: 'supervisor', byUid: 's', byName: 'S', byRole: 'supervisor', at: 1, attempt: 1, checklist: [], evidence: seedPass().evidence }] })
    putFiles(3)
    await submit(drv1(), { attempt: 3 })
    expect((w.passes.get(PASS_ID) as PassData).rejectionHistory?.map((h) => h.attempt)).toEqual([1, 2])
  })
  it('only the same driver may resubmit', async () => {
    rejected()
    putFiles(2)
    await rejects(submit(drv1b(), { attempt: 2 }), 'permission-denied', 'not-resubmitter')
  })
  it('wrong attempt numbers are rejected', async () => {
    putFiles(1)
    await rejects(submit(drv1(), { attempt: 2 }), 'failed-precondition', 'attempt-mismatch')
    rejected()
    putFiles(2)
    for (const attempt of [1, 3]) await rejects(submit(drv1(), { attempt }), 'failed-precondition', 'attempt-mismatch')
    await rejects(submit(drv1(), { attempt: 0 }), 'invalid-argument', 'invalid-input')
    await rejects(submit(drv1(), { attempt: 6 }), 'invalid-argument', 'invalid-input')
  })
  it('stops after 5 attempts', async () => {
    rejected({ attempt: 5 })
    putFiles(6)
    await rejects(submit(drv1(), { attempt: 5 }), 'failed-precondition', 'attempts-exhausted')
  })

  describe('checklist', () => {
    beforeEach(() => putFiles())
    it('a missing item, a duplicate and an unknown item are rejected', async () => {
      await rejects(submit(drv1(), { checklist: answers().slice(1) }), 'invalid-argument', 'checklist-invalid')
      await rejects(submit(drv1(), { checklist: [...answers(), { id: 'dashcam_card', answer: 'yes' }] }), 'invalid-argument', 'checklist-invalid')
      await rejects(submit(drv1(), { checklist: [...answers(), { id: 'bogus', answer: 'yes' }] }), 'invalid-argument', 'checklist-invalid')
    })
    it('a "no" needs a note of at least 3 characters', async () => {
      await rejects(submit(drv1(), { checklist: answers({ gps_online: { answer: 'no' } }) }), 'invalid-argument', 'checklist-note-required')
      await rejects(submit(drv1(), { checklist: answers({ gps_online: { answer: 'no', note: ' ab ' } }) }), 'invalid-argument', 'checklist-note-required')
      await submit(drv1(), { checklist: answers({ gps_online: { answer: 'no', note: ' No signal ' } }) })
      expect((w.passes.get(PASS_ID) as PassData).checklist.find((c) => c.id === 'gps_online')).toEqual({
        id: 'gps_online', label: 'GPS device is powered and online', answer: 'no', note: 'No signal',
      })
    })
    it('a failBlocks item answered no is rejected with a clear message', async () => {
      w.tenants.set('T1', { timezone: 'Asia/Colombo', checklist: [{ id: 'brakes', label: 'Brakes work', failBlocks: true }] })
      const p = submit(drv1(), { checklist: [{ id: 'brakes', answer: 'no', note: 'spongy' }] })
      await rejects(p, 'failed-precondition', 'checklist-blocked')
      await expect(p).rejects.toThrow(/Brakes work/)
      expect(w.passes.size).toBe(0)
    })
  })

  describe('evidence', () => {
    it('a missing file is rejected', async () => {
      putFiles(1, ['gps.jpg'])
      await rejects(submit(), 'failed-precondition', 'evidence-missing')
    })
    it('a missing extra file is rejected', async () => {
      putFiles()
      await rejects(submit(drv1(), { extraCount: 1 }), 'failed-precondition', 'evidence-missing')
    })
    it('photos uploaded for a different attempt do not count', async () => {
      putFiles(2)
      await rejects(submit(), 'failed-precondition', 'evidence-missing')
    })
    it('a stale file (over 30 minutes old) is rejected, 29 minutes is fine', async () => {
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { timeCreated: NOW * 1000 - 31 * 60_000 })
      await rejects(submit(), 'failed-precondition', 'evidence-stale')
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { timeCreated: NOW * 1000 - 29 * 60_000 })
      await submit()
    })
    it('non-JPEG content is rejected by content type and by signature', async () => {
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { contentType: 'image/png' })
      await rejects(submit(), 'failed-precondition', 'evidence-invalid')
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { head: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })
      await rejects(submit(), 'failed-precondition', 'evidence-invalid')
    })
    it('too small and oversize files are rejected', async () => {
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { size: 800 * 1024 })
      await rejects(submit(), 'failed-precondition', 'evidence-invalid')
      putFiles(1, ['gps.jpg', 'dashcam.jpg'], { size: 2 * 1024 })
      await rejects(submit(), 'failed-precondition', 'evidence-invalid')
    })
    it('extraCount above the tenant maximum is rejected', async () => {
      putFiles(1, ['gps.jpg', 'dashcam.jpg', 'extra1.jpg', 'extra2.jpg'])
      w.tenants.set('T1', { timezone: 'Asia/Colombo', passSettings: { maxExtraPhotos: 1 } })
      await rejects(submit(drv1(), { extraCount: 2 }), 'invalid-argument', 'invalid-input')
      await submit(drv1(), { extraCount: 1 })
    })
  })

  describe('location', () => {
    beforeEach(() => putFiles())
    it('is required when the tenant asks for it', async () => {
      w.tenants.set('T1', { timezone: 'Asia/Colombo', passSettings: { requireLocation: true } })
      await rejects(submit(), 'failed-precondition', 'location-required')
      await submit(drv1(), { captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' }, location: { lat: 1, lng: 2, accuracy: 3 } } })
    })
    it('rejects out-of-range coordinates', async () => {
      await rejects(submit(drv1(), { captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' }, location: { lat: 91, lng: 2, accuracy: 3 } } }), 'invalid-argument', 'invalid-input')
    })
  })

  it('a conflict inside the transaction (lost race) is reported as pass-exists', async () => {
    putFiles()
    const real = w.deps.data.getPass
    w.deps.data.getPass = async (id) => {
      const r = await real(id)
      seedPass() // somebody else submits between our read and our write
      return r
    }
    await rejects(submit(), 'already-exists', 'pass-exists')
  })
})

describe('pass rules', () => {
  it('passIdFor is vehicleId_dateKey', () => expect(passIdFor(VID, '20260310')).toBe(`${VID}_20260310`))
  it('expectedAttempt is 1 for a new pass and previous + 1 otherwise', () => {
    expect(expectedAttempt(null)).toBe(1)
    expect(expectedAttempt({ attempt: 1 })).toBe(2)
    expect(expectedAttempt({ attempt: 4 })).toBe(5)
  })
  it('planSubmit', () => {
    const rej = { status: 'rejected' as const, attempt: 2, driverId: 'd' }
    expect(planSubmit(null, 'd', 1)).toBe('create')
    expect(planSubmit(rej, 'd', 3)).toBe('resubmit')
    expect(() => planSubmit(null, 'd', 2)).toThrow()
    expect(() => planSubmit(rej, 'd', 2)).toThrow()
    expect(() => planSubmit(rej, 'x', 3)).toThrow()
    expect(() => planSubmit({ ...rej, status: 'submitted' as never }, 'd', 3)).toThrow()
    expect(() => planSubmit({ ...rej, attempt: 5 }, 'd', 6)).toThrow()
  })
  it('validateChecklist takes labels from the template, not the client', () => {
    const out = validateChecklist([{ id: 'a1', label: 'Real label', failBlocks: false }], [{ id: 'a1', answer: 'yes', note: 'ignored' }])
    expect(out).toEqual([{ id: 'a1', label: 'Real label', answer: 'yes' }])
  })
})

describe('updateTenantSettings', () => {
  const item = (id: string, label = 'Tyres are fine', failBlocks = false) => ({ id, label, failBlocks })
  it('admin updates settings and checklist, audited', async () => {
    await updateTenantSettings(w.deps, admin(), {
      passSettings: { requireLocation: true, maxExtraPhotos: 0 },
      checklist: [item('tyres'), item('lights_ok', 'Lights work', true)],
    })
    expect(w.tenants.get('T1')).toMatchObject({
      timezone: 'Asia/Colombo', passSettings: { requireLocation: true, maxExtraPhotos: 0 },
      checklist: [item('tyres'), item('lights_ok', 'Lights work', true)],
    })
    expect(w.audits.at(-1)).toMatchObject({ action: 'tenant.settings.update', targetType: 'tenant', targetId: 'T1' })
  })
  it('a partial update leaves the other part alone', async () => {
    await updateTenantSettings(w.deps, admin(), { checklist: [item('tyres')] })
    expect(w.tenants.get('T1')?.passSettings).toBeUndefined()
  })
  it('admin only', async () => {
    for (const c of [sup1(), drv1(), caller('officer', 'officer')]) {
      await rejects(updateTenantSettings(w.deps, c, { checklist: [item('tyres')] }), 'permission-denied')
    }
  })
  it('validates: max 12 items, label length, slug ids, unique ids, at least one item, settings range', async () => {
    const bad: unknown[] = [
      { checklist: Array.from({ length: 13 }, (_, i) => item(`item_${i}`)) },
      { checklist: [item('tyres', 'ab')] },
      { checklist: [item('tyres', 'x'.repeat(61))] },
      { checklist: [item('Bad Id')] },
      { checklist: [item('tyres'), item('tyres', 'Other label')] },
      { checklist: [] },
      { passSettings: { requireLocation: false, maxExtraPhotos: 3 } },
      {},
    ]
    for (const b of bad) await rejects(updateTenantSettings(w.deps, admin(), b), 'invalid-argument')
    await updateTenantSettings(w.deps, admin(), { checklist: Array.from({ length: 12 }, (_, i) => item(`item_${i}`)) })
  })
  it('sla: admin saves 5 to 240 whole minutes, anything else is refused', async () => {
    await updateTenantSettings(w.deps, admin(), { sla: { supervisorMinutes: 45, officerMinutes: 5 } })
    expect(w.tenants.get('T1')?.sla).toEqual({ supervisorMinutes: 45, officerMinutes: 5 })
    for (const sla of [
      { supervisorMinutes: 4, officerMinutes: 30 },
      { supervisorMinutes: 30, officerMinutes: 241 },
      { supervisorMinutes: 30.5, officerMinutes: 30 },
      { supervisorMinutes: 30 },
    ]) {
      await rejects(updateTenantSettings(w.deps, admin(), { sla }), 'invalid-argument')
    }
    await rejects(updateTenantSettings(w.deps, caller('officer', 'officer'), { sla: { supervisorMinutes: 30, officerMinutes: 30 } }), 'permission-denied')
  })
})
