// The real PIN ports against the Firestore emulator (`npm run test:functions` starts it). Skipped without it.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PinTakenError } from './core.js'
import { pinKey } from './pin.js'
import { MAX_KNOWN_DEVICES, PROBE_SHARDS } from './pinLogin.js'
import { pinLoginPort } from './pinLoginPort.js'
import { dataPort } from './ports.js'
import { TEST_PEPPER, userDoc } from './test-utils.js'
import type { AuditEntry } from './types.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const audit: AuditEntry = { tenantId: 'T1', action: 'test', actorUid: 'admin', actorRole: 'admin', targetType: 'user', targetId: 'x', meta: {} }

describe.skipIf(!emulator)('PIN ports (emulator)', () => {
  let db: FirebaseFirestore.Firestore
  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })
  beforeEach(async () => {
    for (const c of ['users', 'drivers', 'auditLog', 'pinIndex', 'pinAttempts', 'platformAuditLog']) await db.recursiveDelete(db.collection(c))
  })

  it('concurrent creations with one PIN: exactly one user gets it, the others see PinTakenError', async () => {
    const key = pinKey('48291736', TEST_PEPPER)
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        dataPort().createUserWithAudit(`u${i}`, userDoc({ loginType: 'pin' }), 'admin', audit, undefined, { key, entry: { uid: `u${i}`, tenantId: 'T1', role: 'driver' }, sealed: 'sealed' }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PinTakenError)
    expect((await db.collection('users').get()).size).toBe(1)
    const owner = (await db.doc(`pinIndex/${key}`).get()).data()
    expect(owner).toMatchObject({ tenantId: 'T1', role: 'driver' })
    expect((await db.doc(`users/${owner?.uid as string}`).get()).exists).toBe(true)
  })

  it('reissuePinTx: old pinIndex gone, new one created, knownDevices cleared, taken key refused', async () => {
    const oldKey = pinKey('48291736', TEST_PEPPER)
    const newKey = pinKey('59302847', TEST_PEPPER)
    await dataPort().createUserWithAudit('u1', userDoc({ loginType: 'pin' }), 'admin', audit, undefined, { key: oldKey, entry: { uid: 'u1', tenantId: 'T1', role: 'driver' }, sealed: 'sealed-old' })
    await db.doc('users/u1').update({ knownDevices: { abc: { firstSeenAt: Timestamp.now(), lastSeenAt: Timestamp.now() } } })
    await db.doc(`pinIndex/${pinKey('70413958', TEST_PEPPER)}`).create({ uid: 'other', tenantId: 'T2', role: 'security' })

    await expect(
      dataPort().reissuePinTx({ uid: 'u1', key: pinKey('70413958', TEST_PEPPER), entry: { uid: 'u1', tenantId: 'T1', role: 'driver' }, sealed: 'x', pinVersion: 2, patch: {}, audit }),
    ).rejects.toBeInstanceOf(PinTakenError)
    expect((await db.doc(`pinIndex/${oldKey}`).get()).exists).toBe(true)

    await dataPort().reissuePinTx({ uid: 'u1', key: newKey, entry: { uid: 'u1', tenantId: 'T1', role: 'driver' }, sealed: 'sealed-new', pinVersion: 2, patch: { pinVersion: 2, sessionsRevokedAt: 123 }, audit })
    expect((await db.doc(`pinIndex/${oldKey}`).get()).exists).toBe(false)
    expect((await db.doc(`pinIndex/${newKey}`).get()).data()).toMatchObject({ uid: 'u1' })
    const user = (await db.doc('users/u1').get()).data()
    expect(user).toMatchObject({ pinVersion: 2, sessionsRevokedAt: 123 })
    expect(user).not.toHaveProperty('knownDevices')
    expect((await db.doc('pinVault/u1').get()).data()).toMatchObject({ sealed: 'sealed-new', pinVersion: 2, tenantId: 'T1' })
  })

  it('recordLogin keeps at most 5 devices and audits; attempts and the probe counter round-trip', async () => {
    await db.doc('users/u1').set(userDoc({ loginType: 'pin' }))
    const port = pinLoginPort()
    const news: boolean[] = []
    for (let i = 0; i < 7; i++) {
      news.push((await port.recordLogin({ uid: 'u1', deviceKey: `d${i}`, nowMs: 1_000 + i, audit: (n) => ({ ...audit, meta: { newDevice: n } }) })).newDevice)
    }
    news.push((await port.recordLogin({ uid: 'u1', deviceKey: 'd6', nowMs: 2_000, audit: (n) => ({ ...audit, meta: { newDevice: n } }) })).newDevice)
    expect(news).toEqual([true, true, true, true, true, true, true, false])
    const user = (await db.doc('users/u1').get()).data() as { knownDevices: Record<string, unknown>; lastLoginAt: Timestamp }
    expect(Object.keys(user.knownDevices).sort()).toEqual(['d2', 'd3', 'd4', 'd5', 'd6'])
    expect(Object.keys(user.knownDevices)).toHaveLength(MAX_KNOWN_DEVICES)
    expect(user.lastLoginAt.toMillis()).toBe(2_000)
    expect((await db.collection('auditLog').get()).size).toBe(8)

    await port.updateAttempts('ip-x', (prev) => ({ windowStart: 5, failures: (prev?.failures ?? 0) + 1, lockedUntil: 0, lockouts: 0, lastLockoutAt: 0 }))
    await port.updateAttempts('ip-x', (prev) => ({ windowStart: 5, failures: (prev?.failures ?? 0) + 1, lockedUntil: 0, lockouts: 0, lastLockoutAt: 0 }))
    expect((await port.getAttempts(['ip-x', 'dev-y'])).get('ip-x')).toMatchObject({ failures: 2, windowStart: 5 })

    for (let i = 0; i < 25; i++) await port.incrementProbe(60_000, i % PROBE_SHARDS)
    expect(await port.sumProbe(60_000)).toBe(25)
    expect(await port.recordProbe(60_000, 25)).toBe(true)
    expect(await port.recordProbe(60_000, 26)).toBe(false)
    expect((await db.doc('platformAuditLog/pinprobe_60000').get()).data()).toMatchObject({ action: 'security.pin_probe_suspected', actorUid: 'system' })
  })
})
