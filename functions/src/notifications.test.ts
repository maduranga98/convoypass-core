import { beforeEach, describe, expect, it } from 'vitest'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { actorOf, deliver, isStaleEvent, MAX_EVENT_AGE_MS, notificationId, planDenial, planPassChange } from './notifications.js'
import { makeNotifyWorld, type NotifyWorld } from './notify-test-utils.js'
import { makeWorld, NOW, userDoc, type World } from './test-utils.js'
import type { GateEventData, PassData, PassStatus } from './types.js'

const VID = 'veh_aaaaaaaaaa'
const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const PID = `${VID}_${DAY}`
const NOW_MS = NOW * 1000

let w: World
let nw: NotifyWorld
beforeEach(() => {
  w = makeWorld()
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1@x.com', phone: null }))
  w.users.set('sup1b', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1b@x.com', phone: null }))
  w.users.set('sup1off', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1o@x.com', phone: null, status: 'disabled' }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, email: 'o@x.com', phone: null }))
  w.users.set('officer2', userDoc({ role: 'officer', contractorId: null, email: 'o2@x.com', phone: null }))
  w.users.set('officerX', userDoc({ tenantId: 'T2', role: 'officer', contractorId: null, email: 'ox@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1' }))
  nw = makeNotifyWorld(w)
})

const pass = (status: PassStatus, over: Partial<PassData> = {}): PassData => ({
  tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'WP LJ-4821', vehicleType: 'Tipper', dateKey: DAY,
  driverId: 'drv1', driverName: 'Dan Driver', status, attempt: 1, submittedAt: NOW_MS - 60_000,
  checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, label: c.label, answer: 'yes' as const })),
  evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
  captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
  ...over,
})
const hist = (byUid: string, action: 'approve' | 'reject' | 'revoke' | 'check_in' = 'approve') => [
  { action, stage: 'supervisor' as const, byUid, byName: 'X', byRole: 'supervisor' as const, at: NOW_MS, attempt: 1 },
]

const run = async (before: PassData | null, after: PassData) => {
  const planned = planPassChange(PID, before, after)
  return deliver(nw.deps, after.tenantId, planned, actorOf(after), { fn: 'test' })
}
const ids = (prefix: string) => nw.uidsWithNotification(prefix)

describe('pass notifications: events and recipients', () => {
  it('a new submitted pass notifies the active supervisors of that contractor only', async () => {
    await run(null, pass('submitted'))
    expect(ids('submitted_')).toEqual(['sup1', 'sup1b'])
    expect(nw.notifications.get(notificationId({ event: 'submitted', sourceId: PID, attempt: 1 }, 'sup1'))).toMatchObject({
      type: 'approval_needed', title: 'Approval needed', link: `/supervisor/approvals/${PID}`, passId: PID, vehicleId: VID, tenantId: 'T1',
    })
  })
  it('supervisor approval notifies the officers of the tenant (not other tenants)', async () => {
    await run(pass('submitted'), pass('supervisor_approved', { history: hist('sup1') }))
    expect(ids('supervisorApproved_')).toEqual(['officer', 'officer2'])
    expect([...nw.notifications.values()][0]).toMatchObject({ title: 'Awaiting officer approval', link: `/officer?pass=${PID}` })
  })
  it('officer approval notifies the driver', async () => {
    await run(pass('supervisor_approved'), pass('officer_approved', { history: hist('officer') }))
    expect(ids('officerApproved_')).toEqual(['drv1'])
    expect([...nw.notifications.values()][0]).toMatchObject({ title: 'Approved. Show your vehicle at the gate', link: '/driver' })
  })
  it('a supervisor rejection notifies the driver with the reason, and only the driver', async () => {
    const rejection = { reason: 'Dashcam not visible', reasonCode: 'dashcam', stage: 'supervisor' as const, byUid: 'sup1', byName: 'Sue', byRole: 'supervisor' as const, at: NOW_MS }
    await run(pass('submitted'), pass('rejected', { rejection, history: hist('sup1', 'reject') }))
    expect(ids('rejected_')).toEqual(['drv1'])
    expect(ids('rejectedInfo_')).toEqual([])
    expect([...nw.notifications.values()][0]?.body).toContain('Dashcam not visible')
  })
  it('an officer-stage rejection also tells the contractor’s supervisors, as information', async () => {
    const rejection = { reason: 'Wrong load', reasonCode: 'other', stage: 'officer' as const, byUid: 'officer', byName: 'Olga', byRole: 'officer' as const, at: NOW_MS }
    await run(pass('supervisor_approved'), pass('rejected', { rejection, history: hist('officer', 'reject') }))
    expect(ids('rejected_')).toEqual(['drv1'])
    expect(ids('rejectedInfo_')).toEqual(['sup1', 'sup1b'])
  })
  it('a revoke (stage revoked) also tells the supervisors', async () => {
    const rejection = { reason: 'Revoked', reasonCode: 'other', stage: 'revoked' as const, byUid: 'admin', byName: 'Ann', byRole: 'admin' as const, at: NOW_MS }
    await run(pass('officer_approved'), pass('rejected', { rejection, history: hist('admin', 'revoke') }))
    expect(ids('rejectedInfo_')).toEqual(['sup1', 'sup1b'])
    expect(nw.notifications.get(notificationId({ event: 'rejectedInfo', sourceId: PID, attempt: 1 }, 'sup1'))?.title).toBe('Pass revoked')
  })
  it('check-in notifies the driver with the gate name', async () => {
    const checkIn = { uid: 'sec', name: 'Sam', at: NOW_MS, gateId: 'main', gateName: 'North Gate', requestId: 'r' }
    await run(pass('officer_approved'), pass('checked_in', { checkIn, history: hist('sec', 'check_in') }))
    expect(ids('checkedIn_')).toEqual(['drv1'])
    expect([...nw.notifications.values()][0]?.title).toBe('Checked in at North Gate')
  })
  it('a resubmission says so, uses the attempt in the id and in the text', async () => {
    await run(null, pass('submitted'))
    const rejected = pass('rejected', { rejection: { reason: 'r', reasonCode: 'o', stage: 'supervisor', byUid: 'sup1', byName: 'S', byRole: 'supervisor', at: 1 } })
    await run(rejected, pass('submitted', { attempt: 2 }))
    expect(nw.notifications.get(notificationId({ event: 'resubmitted', sourceId: PID, attempt: 2 }, 'sup1'))).toMatchObject({
      type: 'resubmitted', title: 'Resubmitted, attempt 2',
    })
    expect(nw.notifications.get(notificationId({ event: 'submitted', sourceId: PID, attempt: 1 }, 'sup1'))?.title).toBe('Approval needed')
  })
  it('changes that are not status or attempt moves produce nothing (SLA stamp, evidence purge, deletes)', async () => {
    expect(planPassChange(PID, pass('submitted'), pass('submitted', { slaAlerts: { supervisor: { attempt: 1, at: 1 } } }))).toEqual([])
    expect(planPassChange(PID, pass('officer_approved'), pass('officer_approved', { evidenceDeletedAt: 1 }))).toEqual([])
    expect(planPassChange(PID, pass('submitted'), null)).toEqual([])
    expect(planPassChange(PID, null, pass('checked_in'))).toEqual([])
  })
})

describe('pass notifications: who is skipped', () => {
  it('never notifies the person who caused the event', async () => {
    // Contrived: the last history entry names an officer as actor of a supervisor approval.
    await run(pass('submitted'), pass('supervisor_approved', { history: hist('officer') }))
    expect(ids('supervisorApproved_')).toEqual(['officer2'])
  })
  it('skips suspended (disabled) users and users of other tenants', async () => {
    await run(null, pass('submitted'))
    expect(ids('submitted_')).not.toContain('sup1off')
    w.users.set('drv1', userDoc({ contractorId: 'C1', status: 'disabled' }))
    await run(pass('supervisor_approved'), pass('officer_approved'))
    expect(ids('officerApproved_')).toEqual([])
    w.users.set('drv1', userDoc({ tenantId: 'T2', contractorId: 'CX' }))
    await run(pass('supervisor_approved'), pass('officer_approved'))
    expect(ids('officerApproved_')).toEqual([])
  })
  it('a duplicate delivery creates no duplicate docs and sends no second push', async () => {
    nw.addDevice('sup1', 'd1', 'tok-sup1')
    w.passes.set(PID, pass('submitted'))
    const first = await run(null, pass('submitted'))
    const second = await run(null, pass('submitted'))
    expect(first).toMatchObject({ created: 2, duplicates: 0, pushed: 1 })
    expect(second).toMatchObject({ created: 0, duplicates: 2, pushed: 0 })
    expect(nw.notifications.size).toBe(2)
    expect(nw.sent).toHaveLength(1)
  })
  it('an in-app write failure for one recipient is thrown (the trigger retries) after the others were written', async () => {
    nw.failCreateFor.add('sup1')
    await expect(run(null, pass('submitted'))).rejects.toThrow('write failed')
    expect(ids('submitted_')).toEqual(['sup1b'])
    nw.failCreateFor.clear()
    const retry = await run(null, pass('submitted'))
    expect(retry).toMatchObject({ created: 1, duplicates: 1 })
  })
})

describe('stale events', () => {
  it('an event older than six hours is not announced (a seed or a backfill must not flood the bell)', () => {
    expect(isStaleEvent(NOW_MS - MAX_EVENT_AGE_MS + 1000, NOW_MS)).toBe(false)
    expect(isStaleEvent(NOW_MS - MAX_EVENT_AGE_MS - 1000, NOW_MS)).toBe(true)
  })
})

describe('gate denial notifications', () => {
  const event: GateEventData = {
    tenantId: 'T1', type: 'denied', vehicleId: VID, plateNo: 'WP LJ-4821', contractorId: 'C1', passId: PID, passStatus: 'officer_approved',
    driverName: 'Dan', dateKey: DAY, reasonCode: 'driver_mismatch', gateId: 'main', gateName: 'Main Gate', byUid: 'sec', byName: 'Sam', at: NOW_MS, requestId: 'r',
  }
  it('goes to officers, admins and that contractor’s supervisors, not other contractors’ supervisors', async () => {
    w.users.set('sec', userDoc({ role: 'security', contractorId: null, email: 'sec@x.com', phone: null }))
    await deliver(nw.deps, 'T1', planDenial('den_1', event), event.byUid, { fn: 'test' })
    expect(ids('denied_')).toEqual(['admin', 'admin2', 'officer', 'officer2', 'sup1', 'sup1b'])
    expect(nw.notifications.get(notificationId({ event: 'denied', sourceId: 'den_1', attempt: 0 }, 'officer'))).toMatchObject({
      type: 'entry_denied', title: 'Entry denied: WP LJ-4821', body: 'Entry denied: WP LJ-4821, Driver does not match the photo or pass', link: '/officer',
    })
    expect(nw.notifications.get(notificationId({ event: 'denied', sourceId: 'den_1', attempt: 0 }, 'admin'))?.link).toBe('/admin/reports?type=gate_log')
    expect(nw.notifications.get(notificationId({ event: 'denied', sourceId: 'den_1', attempt: 0 }, 'sup1'))?.link).toBe('/supervisor')
  })
  it('excludes the guard who denied entry even if they are in a recipient role', async () => {
    await deliver(nw.deps, 'T1', planDenial('den_2', { ...event, byUid: 'officer' }), 'officer', { fn: 'test' })
    expect(ids('denied_')).not.toContain('officer')
    expect(ids('denied_')).toContain('officer2')
  })
})
