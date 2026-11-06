import { beforeEach, describe, expect, it } from 'vitest'
import { bulkApprove, decidePass, reasonText, revokePass } from './approvals.js'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { DEFAULT_REJECTION_REASONS } from './defaultRejectionReasons.js'
import { evidenceFolder } from './passRules.js'
import { submitPass, updateTenantSettings } from './passes.js'
import { canTransition, TRANSITIONS } from './passTransitions.js'
import { admin, caller, drv1, makeWorld, NOW, rejects, sup1, sup2, userDoc, type World } from './test-utils.js'
import type { Caller, PassData, PassStatus, StoredFile } from './types.js'

const VID = 'veh_aaaaaaaaaa'
const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const YESTERDAY = dateKey('Asia/Colombo', new Date((NOW - 86_400) * 1000))
const pid = (vehicleId = VID, day = DAY) => `${vehicleId}_${day}`

const officer = () => caller('officer', 'officer')
const security = () => caller('sec', 'security')

let w: World
beforeEach(() => {
  w = makeWorld()
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', name: 'Sue Super', email: 's1@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, name: 'Olga Officer', email: 'o@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1', name: 'Dan Driver' }))
  w.vehicles.set(VID, {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper',
    assignedDriverIds: ['drv1'], status: 'active',
  })
})

const seed = (status: PassStatus, over: Partial<PassData> = {}, id = pid()): PassData => {
  const p: PassData = {
    tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'WP LJ-4821', vehicleType: 'Tipper', dateKey: DAY,
    driverId: 'drv1', driverName: 'Dan Driver', status, attempt: 1, submittedAt: NOW * 1000 - 5000,
    checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, label: c.label, answer: 'yes' as const })),
    evidence: {
      gps: { path: 'p/gps.jpg', size: 1, contentType: 'image/jpeg' },
      dashcam: { path: 'p/dashcam.jpg', size: 1, contentType: 'image/jpeg' },
      extra: [],
    },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    ...over,
  }
  w.passes.set(id, p)
  return p
}
const stored = (id = pid()) => w.passes.get(id) as PassData
const withIssue = (): Partial<PassData> => ({
  checklist: [{ id: 'dashcam_recording', label: 'Dashcam is recording', answer: 'no', note: 'Loose' }],
})

const decide = (c: Caller, over: Record<string, unknown> = {}) =>
  decidePass(w.deps, c, { passId: pid(), action: 'approve', expectedStatus: 'submitted', expectedAttempt: 1, ...over })

describe('state machine table', () => {
  it('has exactly the six agreed moves, admin only on revoke and security only on check-in', () => {
    expect(TRANSITIONS.map((t) => `${t.from}>${t.to}:${t.action}`)).toEqual([
      'submitted>supervisor_approved:approve',
      'submitted>rejected:reject',
      'supervisor_approved>officer_approved:approve',
      'supervisor_approved>rejected:reject',
      'officer_approved>rejected:revoke',
      'officer_approved>checked_in:check_in',
    ])
    expect(TRANSITIONS.filter((t) => t.roles.includes('security')).map((t) => t.action)).toEqual(['check_in'])
    for (const role of ['admin', 'officer', 'supervisor', 'driver'] as const) {
      expect(canTransition(role, 'officer_approved', 'check_in', 'gate')).toBe(false)
    }
    expect(canTransition('security', 'officer_approved', 'check_in', 'gate')).toBe(true)
    // Nothing leaves checked_in: no check-out, no revoke.
    expect(TRANSITIONS.filter((t) => t.from === 'checked_in')).toEqual([])
    expect(TRANSITIONS.filter((t) => t.roles.includes('admin')).map((t) => t.action)).toEqual(['revoke'])
    expect(canTransition('admin', 'submitted', 'approve', 'supervisor')).toBe(false)
    expect(canTransition('officer', 'submitted', 'approve', 'supervisor')).toBe(false)
  })
})

describe('decidePass: allowed transitions', () => {
  it('supervisor approves submitted -> supervisor_approved with their name, time and history', async () => {
    seed('submitted')
    expect(await decide(sup1())).toMatchObject({ passId: pid(), status: 'supervisor_approved' })
    expect(stored()).toMatchObject({
      status: 'supervisor_approved',
      supervisor: { uid: 'sup1', name: 'Sue Super', at: NOW * 1000 },
      history: [{ action: 'approve', stage: 'supervisor', byUid: 'sup1', byName: 'Sue Super', byRole: 'supervisor', at: NOW * 1000, attempt: 1 }],
    })
    expect(stored().officer).toBeUndefined()
    expect(w.audits.at(-1)).toMatchObject({ action: 'pass.approve.supervisor', targetType: 'pass', targetId: pid(), actorUid: 'sup1' })
  })
  it('officer approves supervisor_approved -> officer_approved', async () => {
    seed('supervisor_approved', { supervisor: { uid: 'sup1', name: 'Sue Super', at: 1 } })
    await decide(officer(), { expectedStatus: 'supervisor_approved' })
    expect(stored()).toMatchObject({ status: 'officer_approved', officer: { uid: 'officer', name: 'Olga Officer' }, supervisor: { uid: 'sup1' } })
    expect(stored().history).toHaveLength(1)
    expect(w.audits.at(-1)).toMatchObject({ action: 'pass.approve.officer' })
  })
  it('supervisor rejects with a reason: rejection block, label as reason, history', async () => {
    seed('submitted')
    await decide(sup1(), { action: 'reject', reasonCode: 'gps_unclear' })
    expect(stored()).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'GPS photo unclear or device not visible', reasonCode: 'gps_unclear', stage: 'supervisor', byUid: 'sup1', byName: 'Sue Super', byRole: 'supervisor', at: NOW * 1000 },
      history: [{ action: 'reject', stage: 'supervisor' }],
    })
    expect(stored().rejection?.note).toBeUndefined()
    expect(w.audits.at(-1)).toMatchObject({ action: 'pass.reject.supervisor', meta: { reasonCode: 'gps_unclear' } })
  })
  it('officer rejects supervisor_approved; the note is appended to the label', async () => {
    seed('supervisor_approved')
    await decide(officer(), { action: 'reject', expectedStatus: 'supervisor_approved', reasonCode: 'checklist_issue', note: '  Lens loose ' })
    expect(stored()).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'Checklist problem needs fixing: Lens loose', note: 'Lens loose', stage: 'officer' },
    })
  })
  it('"other" uses the note alone as the reason', async () => {
    seed('submitted')
    await decide(sup1(), { action: 'reject', reasonCode: 'other', note: 'Plate is covered in mud' })
    expect(stored().rejection).toMatchObject({ reason: 'Plate is covered in mud', reasonCode: 'other' })
    expect(reasonText('other', 'Other', undefined)).toBe('Other')
  })
  it('uses the tenant’s own reason list when configured', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', rejectionReasons: [{ id: 'blurry', label: 'Blurry photo' }, { id: 'other', label: 'Other' }] })
    seed('submitted')
    await rejects(decide(sup1(), { action: 'reject', reasonCode: 'gps_unclear' }), 'invalid-argument', 'reason-invalid')
    await decide(sup1(), { action: 'reject', reasonCode: 'blurry' })
    expect(stored().rejection?.reason).toBe('Blurry photo')
  })
})

describe('decidePass: refusals', () => {
  it('admin can never approve or reject, security and drivers neither', async () => {
    for (const status of ['submitted', 'supervisor_approved'] as const) {
      seed(status)
      for (const c of [admin(), security(), drv1()]) {
        await rejects(decide(c, { expectedStatus: status }), 'permission-denied', 'forbidden')
        await rejects(decide(c, { expectedStatus: status, action: 'reject', reasonCode: 'gps_unclear' }), 'permission-denied', 'forbidden')
      }
      expect(stored().status).toBe(status)
    }
  })
  it('wrong stage: supervisor on supervisor_approved, officer on submitted', async () => {
    seed('supervisor_approved')
    await rejects(decide(sup1(), { expectedStatus: 'supervisor_approved' }), 'permission-denied', 'wrong-stage')
    seed('submitted')
    await rejects(decide(officer()), 'permission-denied', 'wrong-stage')
    await rejects(decide(sup1(), { expectedStatus: 'officer_approved' }), 'permission-denied', 'wrong-stage')
    expect(stored().status).toBe('submitted')
  })
  it('a supervisor cannot decide another contractor’s pass', async () => {
    seed('submitted')
    await rejects(decide(sup2()), 'permission-denied', 'forbidden')
    expect(stored().status).toBe('submitted')
  })
  it('another tenant is refused', async () => {
    seed('submitted')
    const foreign = caller('foreignOfficer', 'officer', null, { tenantId: 'T2' })
    w.users.set('foreignOfficer', userDoc({ tenantId: 'T2', role: 'officer', contractorId: null }))
    seed('supervisor_approved')
    await rejects(decide(foreign, { expectedStatus: 'supervisor_approved' }), 'permission-denied', 'tenant-mismatch')
    expect(stored().status).toBe('supervisor_approved')
  })
  it('unknown pass', async () => {
    await rejects(decide(sup1(), { passId: 'veh_zzzzzzzzzz_20231115' }), 'not-found', 'pass-not-found')
  })
  it('a pass from a previous day can never be approved or rejected', async () => {
    seed('submitted', { dateKey: YESTERDAY })
    await rejects(decide(sup1()), 'failed-precondition', 'pass-expired')
    await rejects(decide(sup1(), { action: 'reject', reasonCode: 'gps_unclear' }), 'failed-precondition', 'pass-expired')
    seed('supervisor_approved', { dateKey: YESTERDAY })
    await rejects(decide(officer(), { expectedStatus: 'supervisor_approved' }), 'failed-precondition', 'pass-expired')
    expect(stored().status).toBe('supervisor_approved')
    expect(stored().history).toBeUndefined()
  })
  it('the day is judged in the tenant timezone', async () => {
    // 2023-11-14 22:13 UTC is already the 15th in Colombo but still the 14th in Los Angeles.
    w.tenants.set('T1', { timezone: 'America/Los_Angeles' })
    seed('submitted', { dateKey: '20231114' })
    await decide(sup1())
    expect(stored().status).toBe('supervisor_approved')
  })
  it('suspended vehicle, contractor or driver each fail with their own reason', async () => {
    seed('submitted')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, status: 'suspended' })
    await rejects(decide(sup1()), 'failed-precondition', 'vehicle-suspended')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, status: 'active' })
    w.users.set('drv1', userDoc({ contractorId: 'C1', status: 'disabled' }))
    await rejects(decide(sup1()), 'failed-precondition', 'driver-inactive')
    w.users.set('drv1', userDoc({ contractorId: 'C1' }))
    seed('supervisor_approved')
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(decide(officer(), { expectedStatus: 'supervisor_approved' }), 'failed-precondition', 'contractor-suspended')
    expect(stored().status).toBe('supervisor_approved')
  })
  it('a supervisor of a suspended contractor is refused up front', async () => {
    seed('submitted')
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(decide(sup1()), 'permission-denied', 'caller-not-active')
  })
  it('stale attempt or status returns the "changed" error', async () => {
    seed('submitted', { attempt: 2 })
    await rejects(decide(sup1()), 'failed-precondition', 'pass-changed')
    seed('supervisor_approved')
    await rejects(decide(sup1()), 'failed-precondition', 'pass-changed')
    await expect(decide(sup1())).rejects.toMatchObject({ message: 'This pass changed. Please review it again.' })
  })
  it('approving an already-decided pass fails', async () => {
    seed('submitted')
    await decide(sup1())
    await rejects(decide(sup1()), 'failed-precondition', 'pass-changed')
    seed('rejected')
    await rejects(decide(sup1()), 'failed-precondition', 'pass-changed')
    seed('checked_in')
    await rejects(decide(officer(), { expectedStatus: 'supervisor_approved' }), 'failed-precondition', 'pass-changed')
  })
  it('unknown or missing reason code, and "other" without a real note', async () => {
    seed('submitted')
    await rejects(decide(sup1(), { action: 'reject', reasonCode: 'nope' }), 'invalid-argument', 'reason-invalid')
    await rejects(decide(sup1(), { action: 'reject' }), 'invalid-argument', 'reason-invalid')
    await rejects(decide(sup1(), { action: 'reject', reasonCode: 'other' }), 'invalid-argument', 'note-required')
    await rejects(decide(sup1(), { action: 'reject', reasonCode: 'other', note: ' a ' }), 'invalid-argument', 'note-required')
    expect(stored().status).toBe('submitted')
  })
  it('rejects malformed input', async () => {
    seed('submitted')
    await rejects(decide(sup1(), { action: 'delete' }), 'invalid-argument', 'invalid-input')
    await rejects(decide(sup1(), { expectedAttempt: 0 }), 'invalid-argument', 'invalid-input')
  })
  it('a single approval is allowed even when the checklist has a "No" (only bulk refuses)', async () => {
    seed('submitted', withIssue())
    await decide(sup1())
    expect(stored().status).toBe('supervisor_approved')
  })
})

describe('bulkApprove', () => {
  const idOf = (n: number) => `veh_${String(n).padStart(10, 'b')}`
  const seedMany = () => {
    for (const n of [1, 2, 3, 4]) {
      w.vehicles.set(idOf(n), { ...w.vehicles.get(VID)!, plateNo: `P${n}`, plateKey: `P${n}` })
    }
    seed('submitted', { vehicleId: idOf(1) }, pid(idOf(1))) // ok
    seed('submitted', { vehicleId: idOf(2), ...withIssue() }, pid(idOf(2))) // issues
    seed('submitted', { vehicleId: idOf(3), attempt: 2 }, pid(idOf(3))) // stale (client thinks attempt 1)
    seed('submitted', { vehicleId: idOf(4), contractorId: 'C2' }, pid(idOf(4))) // other contractor
  }
  it('mixed batch returns correct per-item results and only approves the good one', async () => {
    seedMany()
    const items = [1, 2, 3, 4].map((n) => ({ passId: pid(idOf(n)), expectedAttempt: 1 }))
    items.push({ passId: 'veh_zzzzzzzzzz_20231115', expectedAttempt: 1 })
    const { results } = await bulkApprove(w.deps, sup1(), { items })
    expect(results).toEqual([
      { passId: pid(idOf(1)), ok: true },
      { passId: pid(idOf(2)), ok: false, error: 'has_issues' },
      { passId: pid(idOf(3)), ok: false, error: 'pass-changed' },
      { passId: pid(idOf(4)), ok: false, error: 'forbidden' },
      { passId: 'veh_zzzzzzzzzz_20231115', ok: false, error: 'pass-not-found' },
    ])
    expect(stored(pid(idOf(1))).status).toBe('supervisor_approved')
    for (const n of [2, 3, 4]) expect(stored(pid(idOf(n))).status).toBe('submitted')
    expect(w.audits.filter((a) => a.action === 'pass.approve.supervisor')).toHaveLength(1)
  })
  it('the caller’s role decides the stage: an officer approves supervisor_approved passes', async () => {
    seed('supervisor_approved')
    seed('submitted', { vehicleId: idOf(1) }, pid(idOf(1)))
    w.vehicles.set(idOf(1), { ...w.vehicles.get(VID)! })
    const { results } = await bulkApprove(w.deps, officer(), {
      items: [{ passId: pid(), expectedAttempt: 1 }, { passId: pid(idOf(1)), expectedAttempt: 1 }],
    })
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(stored().status).toBe('officer_approved')
  })
  it('refuses issue passes at the officer stage too, and expired passes', async () => {
    seed('supervisor_approved', withIssue())
    expect((await bulkApprove(w.deps, officer(), { items: [{ passId: pid(), expectedAttempt: 1 }] })).results[0]).toMatchObject({ ok: false, error: 'has_issues' })
    seed('submitted', { dateKey: YESTERDAY })
    expect((await bulkApprove(w.deps, sup1(), { items: [{ passId: pid(), expectedAttempt: 1 }] })).results[0]).toMatchObject({ ok: false, error: 'pass-expired' })
  })
  it('admin, security and drivers cannot bulk approve', async () => {
    seed('submitted')
    for (const c of [admin(), security(), drv1()]) {
      await rejects(bulkApprove(w.deps, c, { items: [{ passId: pid(), expectedAttempt: 1 }] }), 'permission-denied', 'forbidden')
    }
  })
  it('caps the batch at 50 items and refuses an empty one', async () => {
    const item = (n: number) => ({ passId: `veh_${String(n).padStart(10, 'a')}_${DAY}`, expectedAttempt: 1 })
    const fifty = Array.from({ length: 50 }, (_, n) => item(n))
    const ok = await bulkApprove(w.deps, sup1(), { items: fifty })
    expect(ok.results).toHaveLength(50)
    await rejects(bulkApprove(w.deps, sup1(), { items: [...fifty, item(50)] }), 'invalid-argument', 'invalid-input')
    await rejects(bulkApprove(w.deps, sup1(), { items: [] }), 'invalid-argument', 'invalid-input')
  })
  it('the same pass twice in one batch is approved once', async () => {
    seed('submitted')
    const { results } = await bulkApprove(w.deps, sup1(), { items: [{ passId: pid(), expectedAttempt: 1 }, { passId: pid(), expectedAttempt: 1 }] })
    expect(results.map((r) => r.ok)).toEqual([true, false])
  })
})

describe('revokePass', () => {
  const revoke = (c: Caller, over: Record<string, unknown> = {}) => revokePass(w.deps, c, { passId: pid(), reasonCode: 'photo_not_fresh', ...over })

  it('officer and admin revoke an officer_approved pass', async () => {
    for (const [c, role] of [[officer(), 'officer'], [admin(), 'admin']] as const) {
      seed('officer_approved', { supervisor: { uid: 'sup1', name: 'Sue', at: 1 }, officer: { uid: 'officer', name: 'Olga', at: 2 } })
      await revoke(c, { note: 'Seen again' })
      expect(stored()).toMatchObject({
        status: 'rejected',
        rejection: { stage: 'revoked', reasonCode: 'photo_not_fresh', byRole: role, reason: 'Photo looks old or reused: Seen again' },
        history: [{ action: 'revoke', stage: 'revoked', byRole: role }],
      })
      expect(w.audits.at(-1)).toMatchObject({ action: 'pass.revoke', actorRole: role })
    }
  })
  it('fails on checked_in and on any other status; supervisors and drivers are denied', async () => {
    seed('checked_in')
    await rejects(revoke(officer()), 'failed-precondition', 'already-checked-in')
    await rejects(revoke(admin()), 'failed-precondition', 'already-checked-in')
    for (const s of ['submitted', 'supervisor_approved', 'rejected'] as const) {
      seed(s)
      await rejects(revoke(officer()), 'failed-precondition', 'pass-changed')
    }
    seed('officer_approved')
    await rejects(revoke(sup1()), 'permission-denied', 'forbidden')
    await rejects(revoke(drv1()), 'permission-denied', 'forbidden')
    await rejects(revoke(security()), 'permission-denied', 'forbidden')
    expect(stored().status).toBe('officer_approved')
  })
  it('validates the reason, other tenants and the optional attempt guard', async () => {
    seed('officer_approved')
    await rejects(revoke(officer(), { reasonCode: 'nope' }), 'invalid-argument', 'reason-invalid')
    await rejects(revoke(officer(), { reasonCode: 'other' }), 'invalid-argument', 'note-required')
    await rejects(revoke(officer(), { expectedAttempt: 2 }), 'failed-precondition', 'pass-changed')
    w.users.set('foreignAdmin', userDoc({ tenantId: 'T2', role: 'admin', contractorId: null }))
    await rejects(revoke(caller('foreignAdmin', 'admin', null, { tenantId: 'T2' })), 'permission-denied', 'tenant-mismatch')
  })
  it('works even when the vehicle is suspended (that is when you need it)', async () => {
    seed('officer_approved')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, status: 'suspended' })
    await revoke(officer())
    expect(stored().status).toBe('rejected')
  })
  it('does not revoke a pass from a previous day', async () => {
    seed('officer_approved', { dateKey: YESTERDAY })
    await rejects(revoke(officer()), 'failed-precondition', 'pass-expired')
  })

  it('then the same driver resubmits with attempt + 1 and the whole history survives', async () => {
    // Walk the real chain: attempt 1 approved twice, revoked, resubmitted as attempt 2, rejected, resubmitted as attempt 3.
    const files = (attempt: number) => {
      const jpeg: StoredFile = { contentType: 'image/jpeg', size: 50 * 1024, timeCreated: NOW * 1000 - 1000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }
      for (const n of ['gps.jpg', 'dashcam.jpg']) w.files.set(`${evidenceFolder('T1', VID, DAY, attempt)}${n}`, jpeg)
    }
    const submit = (attempt: number) => submitPass(w.deps, drv1(), {
      vehicleId: VID, attempt, extraCount: 0,
      checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, answer: 'yes' })),
      captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' } },
    })
    seed('submitted')
    await decide(sup1())
    await decide(officer(), { expectedStatus: 'supervisor_approved' })
    await revoke(officer())
    expect(stored().status).toBe('rejected')

    files(2)
    expect(await submit(2)).toMatchObject({ status: 'submitted', attempt: 2 })
    expect(stored()).toMatchObject({ status: 'submitted', attempt: 2 })
    // New attempt, new review: the old stamps are gone, the old rejection moved to rejectionHistory, history is intact.
    expect(stored().supervisor).toBeUndefined()
    expect(stored().officer).toBeUndefined()
    expect(stored().rejection).toBeUndefined()
    expect(stored().rejectionHistory).toMatchObject([{ attempt: 1, stage: 'revoked', reasonCode: 'photo_not_fresh' }])
    expect(stored().history?.map((h) => `${h.action}:${h.stage}:${h.attempt}`)).toEqual(['approve:supervisor:1', 'approve:officer:1', 'revoke:revoked:1'])

    await decide(sup1(), { expectedAttempt: 2, action: 'reject', reasonCode: 'dashcam_unclear' })
    files(3)
    await submit(3)
    expect(stored().history?.map((h) => `${h.action}:${h.stage}:${h.attempt}`)).toEqual([
      'approve:supervisor:1', 'approve:officer:1', 'revoke:revoked:1', 'reject:supervisor:2',
    ])
    expect(stored().rejectionHistory).toHaveLength(2)
    // The attempt-1 evidence references are still on the history entry.
    expect(stored().rejectionHistory?.[0]?.evidence.gps.path).toBe('p/gps.jpg')
  })
})

describe('concurrency', () => {
  it('two simultaneous approvals of the same pass: exactly one succeeds', async () => {
    seed('submitted')
    const results = await Promise.allSettled([decide(sup1()), decide(sup1())])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason).toMatchObject({ details: { reason: 'pass-changed' } })
    expect(stored().history).toHaveLength(1)
    expect(w.audits.filter((a) => a.action === 'pass.approve.supervisor')).toHaveLength(1)
  })
  it('approve racing reject on the same pass: exactly one wins', async () => {
    seed('submitted')
    const results = await Promise.allSettled([decide(sup1()), decide(sup1(), { action: 'reject', reasonCode: 'gps_unclear' })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(stored().history).toHaveLength(1)
  })
})

describe('updateTenantSettings: rejection reasons', () => {
  const reasons = (...ids: string[]) => ids.map((id) => ({ id, label: `Label ${id}` }))
  it('admin saves 2-10 reasons including "other"', async () => {
    await updateTenantSettings(w.deps, admin(), { rejectionReasons: reasons('blurry', 'other') })
    expect(w.tenants.get('T1')?.rejectionReasons).toEqual(reasons('blurry', 'other'))
    expect(w.audits.at(-1)).toMatchObject({ action: 'tenant.settings.update', meta: { rejectionReasons: 2 } })
    expect(DEFAULT_REJECTION_REASONS.at(-1)?.id).toBe('other')
  })
  it('refuses fewer than 2, more than 10, duplicates, bad slugs, short labels and a list without "other"', async () => {
    const bad = (rejectionReasons: unknown) => rejects(updateTenantSettings(w.deps, admin(), { rejectionReasons }), 'invalid-argument', 'invalid-input')
    await bad(reasons('other'))
    await bad(reasons('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'other'))
    await bad(reasons('dup', 'dup', 'other'))
    await bad([{ id: 'Bad Id', label: 'Fine label' }, ...reasons('other')])
    await bad([{ id: 'ok_id', label: 'ab' }, ...reasons('other')])
    await bad(reasons('blurry', 'dark'))
  })
  it('only admins', async () => {
    await rejects(updateTenantSettings(w.deps, sup1(), { rejectionReasons: reasons('a1', 'other') }), 'permission-denied', 'forbidden')
    await rejects(updateTenantSettings(w.deps, officer(), { rejectionReasons: reasons('a1', 'other') }), 'permission-denied', 'forbidden')
  })
})
