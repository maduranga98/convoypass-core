// Runs the real notification ports against the Firestore emulator (`npm run test:functions` starts it).
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dateKey } from './dates.js'
import { registerDevice } from './devices.js'
import { deliver, planPassChange, type NotificationDoc } from './notifications.js'
import { devicePort, notifyPort, slaPort } from './notifyPorts.js'
import { firestoreRateLimitPort, enforceRateLimit } from './rateLimit.js'
import { runSlaCheck } from './sla.js'
import { caller, makeWorld, NOW, rejects } from './test-utils.js'
import type { PassData } from './types.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const NOW_MS = NOW * 1000
const DAY = dateKey('Asia/Colombo', new Date(NOW_MS))
const doc = (over: Partial<NotificationDoc> = {}): NotificationDoc => ({
  tenantId: 'T1', recipientUid: 'u1', type: 'pass_approved', title: 't', body: 'b', link: '/driver', createdAt: NOW_MS, expireAt: NOW_MS + 1000, ...over,
})

describe.skipIf(!emulator)('notification ports (emulator)', () => {
  let db: FirebaseFirestore.Firestore
  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })
  beforeEach(async () => {
    for (const c of ['notifications', 'users', 'passes', 'tenants', 'rateLimits']) await db.recursiveDelete(db.collection(c))
  })

  it('createNotification uses create(): the second delivery reports false and changes nothing', async () => {
    const port = notifyPort()
    expect(await port.createNotification('n1', doc())).toBe(true)
    expect(await port.createNotification('n1', doc({ title: 'changed' }))).toBe(false)
    const snap = await db.doc('notifications/n1').get()
    expect(snap.data()).toMatchObject({ title: 't', readAt: null, tenantId: 'T1', recipientUid: 'u1' })
    expect((snap.data() as { expireAt: Timestamp }).expireAt.toMillis()).toBe(NOW_MS + 1000)
  })

  it('finds active recipients by role and contractor, counts pending passes', async () => {
    const u = (over: object) => ({ tenantId: 'T1', role: 'supervisor', contractorId: 'C1', status: 'active', ...over })
    await db.doc('users/s1').set(u({}))
    await db.doc('users/s2').set(u({ status: 'disabled' }))
    await db.doc('users/s3').set(u({ contractorId: 'C2' }))
    await db.doc('users/o1').set(u({ role: 'officer', contractorId: null }))
    await db.doc('users/x1').set(u({ tenantId: 'T2' }))
    const port = notifyPort()
    expect(await port.listActiveUids({ tenantId: 'T1', role: 'supervisor', contractorId: 'C1' })).toEqual(['s1'])
    expect(await port.listActiveUids({ tenantId: 'T1', role: 'officer' })).toEqual(['o1'])
    expect(await port.isActiveUser('T1', 's2')).toBe(false)
    expect(await port.isActiveUser('T1', 's1')).toBe(true)
    expect(await port.isActiveUser('T2', 's1')).toBe(false)
    for (const [id, status, contractorId] of [['p1', 'submitted', 'C1'], ['p2', 'submitted', 'C2'], ['p3', 'supervisor_approved', 'C1']] as const) {
      await db.doc(`passes/${id}`).set({ tenantId: 'T1', dateKey: DAY, status, contractorId })
    }
    expect(await port.countPending({ tenantId: 'T1', contractorId: 'C1', status: 'submitted', dateKey: DAY })).toBe(1)
    expect(await port.countPending({ tenantId: 'T1', status: 'supervisor_approved', dateKey: DAY })).toBe(1)
  })

  it('devicePort keeps 5 devices (oldest dropped), merges the same token and moves a token between accounts', async () => {
    const w = makeWorld()
    const port = devicePort()
    for (let i = 1; i <= 7; i++) {
      await port.upsertDevice('u1', `dev${i}`, { token: `tok${i}`, platform: 'android', userAgent: 'ua', nowMs: NOW_MS + i * 1000 }, 5)
    }
    const ids = (await db.collection('users/u1/devices').get()).docs.map((d) => d.id).sort()
    expect(ids).toEqual(['dev3', 'dev4', 'dev5', 'dev6', 'dev7'])
    await port.upsertDevice('u1', 'dev9', { token: 'tok7', platform: 'ios', userAgent: 'ua', nowMs: NOW_MS + 99_000 }, 5)
    expect((await db.collection('users/u1/devices').get()).docs.map((d) => d.id).sort()).toEqual(['dev3', 'dev4', 'dev5', 'dev6', 'dev9'])
    await port.upsertDevice('u2', 'devA', { token: 'tok9', platform: 'android', userAgent: 'ua', nowMs: NOW_MS }, 5)
    await port.upsertDevice('u1', 'devB', { token: 'tok9', platform: 'android', userAgent: 'ua', nowMs: NOW_MS }, 5)
    expect((await db.collection('users/u2/devices').get()).size).toBe(0)
    expect((await db.doc('users/u1/devices/devB').get()).exists).toBe(true)
    // Through the callable logic: the user agent is trimmed and the doc has the documented fields.
    await db.doc('users/drv1').set({ tenantId: 'T1', role: 'driver', contractorId: 'C1', status: 'active' })
    await registerDevice(w.deps, port, caller('drv1', 'driver', 'C1'), { deviceId: 'abcdefghijklmnop', token: 't'.repeat(30), platform: 'android' }, { userAgent: 'U'.repeat(500) })
    const d = (await db.doc('users/drv1/devices/abcdefghijklmnop').get()).data() as Record<string, unknown>
    expect(Object.keys(d).sort()).toEqual(['createdAt', 'enabled', 'lastSeenAt', 'platform', 'token', 'userAgent'])
    expect(String(d.userAgent)).toHaveLength(120)
  })

  it('SLA end to end on the real ports: one reminder per stage and attempt, idempotent re-run', async () => {
    await db.doc('tenants/T1').set({ timezone: 'Asia/Colombo' })
    await db.doc('users/sup1').set({ tenantId: 'T1', role: 'supervisor', contractorId: 'C1', status: 'active' })
    await db.doc('users/adm1').set({ tenantId: 'T1', role: 'admin', contractorId: null, status: 'active' })
    const pass = (over: object) => ({ tenantId: 'T1', contractorId: 'C1', vehicleId: 'veh_x', plateNo: 'CAB-1', dateKey: DAY, status: 'submitted', attempt: 1, submittedAt: Timestamp.fromMillis(NOW_MS - 45 * 60_000), ...over })
    await db.doc(`passes/veh_x_${DAY}`).set(pass({}))
    await db.doc(`passes/veh_y_${DAY}`).set(pass({ vehicleId: 'veh_y', submittedAt: Timestamp.fromMillis(NOW_MS - 5 * 60_000) }))
    const notify = { data: notifyPort(), messaging: { sendEach: async () => [] }, now: () => NOW_MS, baseUrl: '' }
    expect(await runSlaCheck(slaPort(), notify)).toMatchObject({ alerted: 1, notifications: 2, failed: 0 })
    expect(await runSlaCheck(slaPort(), notify)).toMatchObject({ alerted: 0, notifications: 0 })
    const stored = (await db.doc(`passes/veh_x_${DAY}`).get()).data() as { slaAlerts: { supervisor: { attempt: number; at: Timestamp } } }
    expect(stored.slaAlerts.supervisor.attempt).toBe(1)
    expect((await db.collection('notifications').get()).docs.map((d) => d.id).sort()).toEqual([`slaSupervisor_veh_x_${DAY}_1_adm1`, `slaSupervisor_veh_x_${DAY}_1_sup1`])
    // A trigger delivery for the same pass state is still a no-op beyond those docs.
    const p = (await db.doc(`passes/veh_x_${DAY}`).get()).data() as unknown as PassData
    expect(planPassChange(`veh_x_${DAY}`, p, p)).toEqual([])
    await deliver(notify, 'T1', [], null, { fn: 'x' })
  })

  it('rate limiter on Firestore: the 31st call in a window is rejected, then the window resets, per user', async () => {
    const port = firestoreRateLimitPort()
    const t0 = 1_700_000_040_000
    for (let i = 0; i < 30; i++) await enforceRateLimit(port, 'u1', 'createUser', t0)
    await rejects(enforceRateLimit(port, 'u1', 'createUser', t0 + 1000), 'resource-exhausted', 'rate-limited')
    await enforceRateLimit(port, 'u2', 'createUser', t0)
    await enforceRateLimit(port, 'u1', 'createUser', t0 + 60_000)
    const d = (await db.doc('rateLimits/u1_createUser').get()).data() as { count: number; expireAt: Timestamp }
    expect(d.count).toBe(1)
    expect(d.expireAt.toMillis()).toBeGreaterThan(t0 + 60_000)
  })
})
