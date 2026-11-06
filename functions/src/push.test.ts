import { beforeEach, describe, expect, it } from 'vitest'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { deliver, planPassChange, sendToDevices } from './notifications.js'
import { makeNotifyWorld, type NotifyWorld } from './notify-test-utils.js'
import { makeWorld, NOW, userDoc, type World } from './test-utils.js'
import type { PassData, PassStatus } from './types.js'

const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
let w: World
let nw: NotifyWorld
beforeEach(() => {
  w = makeWorld()
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, email: 'o@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1' }))
  nw = makeNotifyWorld(w)
})

const pass = (n: number, status: PassStatus = 'submitted', over: Partial<PassData> = {}): [string, PassData] => {
  const vehicleId = `veh_${String(n).padStart(10, 'a')}`
  return [`${vehicleId}_${DAY}`, {
    tenantId: 'T1', contractorId: 'C1', vehicleId, plateNo: `CAB-${n}`, vehicleType: 'Tipper', dateKey: DAY, driverId: 'drv1', driverName: 'D',
    status, attempt: 1, submittedAt: NOW * 1000 - 1000,
    checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, label: c.label, answer: 'yes' as const })),
    evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } }, ...over,
  }]
}
const submit = async (n: number) => {
  const [id, p] = pass(n)
  w.passes.set(id, p)
  return deliver(nw.deps, 'T1', planPassChange(id, null, p), null, { fn: 'test' })
}

describe('push', () => {
  it('collapses approval pushes: stable tag, current pending count, latest plate in the title, 1 h TTL, data only', async () => {
    nw.addDevice('sup1', 'd1', 'tok-sup1')
    await submit(1)
    await submit(2)
    await submit(3)
    expect(nw.sent).toHaveLength(3)
    const last = nw.sent.at(-1)
    expect(last?.data).toMatchObject({
      tag: 'pending-supervisor-C1', title: 'Approval needed: CAB-3', body: '3 passes awaiting your approval', renotify: '1', link: expect.stringContaining('/supervisor/approvals/'),
    })
    expect(last?.webpush.headers.TTL).toBe('3600')
    expect(last?.webpush.fcmOptions?.link).toMatch(/^https:\/\/app\.example\.com\/supervisor\/approvals\//)
    expect(nw.sent[0]?.data.body).toBe('1 pass awaiting your approval')
    expect(last).not.toHaveProperty('notification') // data-only: the service worker displays it
    // In-app items stay one per pass.
    expect(nw.uidsWithNotification('submitted_')).toEqual(['sup1', 'sup1', 'sup1'])
  })
  it('officer approval push is collapsed per tenant with the supervisor_approved count', async () => {
    nw.addDevice('officer', 'd1', 'tok-o')
    for (const n of [1, 2]) {
      const [id, p] = pass(n, 'supervisor_approved')
      w.passes.set(id, p)
      await deliver(nw.deps, 'T1', planPassChange(id, pass(n)[1], p), null, { fn: 'test' })
    }
    expect(nw.sent.at(-1)?.data).toMatchObject({ tag: 'pending-officer-tenant', body: '2 passes awaiting your approval', title: 'Awaiting officer approval: CAB-2' })
  })
  it('does not send a stale approval push when nothing is pending any more', async () => {
    nw.addDevice('sup1', 'd1', 'tok-sup1')
    const [id, p] = pass(1)
    // The pass was approved by the time the trigger ran: nothing waits.
    w.passes.set(id, { ...p, status: 'supervisor_approved' })
    await deliver(nw.deps, 'T1', planPassChange(id, null, p), null, { fn: 'test' })
    expect(nw.sent).toHaveLength(0)
    expect(nw.uidsWithNotification('submitted_')).toEqual(['sup1']) // the in-app item still exists
  })
  it('non-approval pushes carry their own tag and no collapse', async () => {
    nw.addDevice('drv1', 'd1', 'tok-d')
    const [id, p] = pass(1, 'officer_approved')
    await deliver(nw.deps, 'T1', planPassChange(id, pass(1, 'supervisor_approved')[1], p), null, { fn: 'test' })
    expect(nw.sent[0]?.data.tag).toBe(`pass_approved-${id}`)
    expect(nw.sent[0]?.webpush.headers.TTL).toBeUndefined()
  })
  it('deletes a device whose token is not registered or invalid, keeps the others, and still sends to the good one', async () => {
    nw.addDevice('drv1', 'gone', 'tok-gone')
    nw.addDevice('drv1', 'bad', 'tok-bad')
    nw.addDevice('drv1', 'good', 'tok-good')
    nw.addDevice('drv1', 'flaky', 'tok-flaky')
    nw.sendResult = (t) =>
      t === 'tok-gone' ? { success: false, errorCode: 'messaging/registration-token-not-registered' }
      : t === 'tok-bad' ? { success: false, errorCode: 'messaging/invalid-registration-token' }
      : t === 'tok-flaky' ? { success: false, errorCode: 'messaging/internal-error' }
      : { success: true }
    const sent = await sendToDevices(nw.deps, 'drv1', await nw.deps.data.listDevices('drv1'), { title: 't', body: 'b', link: '/driver', tag: 'x', type: 'pass_approved' }, { fn: 'test' })
    expect(sent).toBe(true)
    expect([...(nw.devices.get('drv1')?.keys() ?? [])].sort()).toEqual(['flaky', 'good'])
  })
  it('a push failure never fails the trigger and the in-app item is still created', async () => {
    nw.addDevice('sup1', 'd1', 'tok-sup1')
    nw.failSend = true
    await expect(submit(1)).resolves.toMatchObject({ created: 1, pushed: 0 })
    expect(nw.notifications.size).toBe(1)
  })
  it('a throwing device lookup is swallowed too', async () => {
    nw.deps.data.listDevices = async () => {
      throw new Error('firestore hiccup')
    }
    await expect(submit(1)).resolves.toMatchObject({ created: 1, pushed: 0 })
  })
  it('sends nothing to users with no devices or only disabled ones; no absolute link without an https base URL', async () => {
    nw.addDevice('sup1', 'off', 'tok-off', { enabled: false })
    await submit(1)
    expect(nw.sent).toHaveLength(0)
    nw.addDevice('drv1', 'd', 'tok-d')
    nw.deps.baseUrl = 'http://localhost:5173'
    await sendToDevices(nw.deps, 'drv1', await nw.deps.data.listDevices('drv1'), { title: 't', body: 'b', link: '/driver', tag: 'x', type: 'x' }, { fn: 'test' })
    expect(nw.sent[0]?.webpush.fcmOptions).toBeUndefined()
  })
})
