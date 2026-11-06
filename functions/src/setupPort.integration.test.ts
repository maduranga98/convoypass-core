// Runs the real invite transactions against the Firestore emulator (`npm run test:functions` starts it).
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClaimLostError } from './setup.js'
import { setupPort } from './setupPort.js'
import { CLAIM_TTL_MS } from './tenants/inviteCode.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const HASH = 'a'.repeat(64)
const NOW = 1_800_000_000_000

describe.skipIf(!emulator)('setup port (emulator)', () => {
  let db: FirebaseFirestore.Firestore
  const port = () => setupPort()
  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })
  beforeEach(async () => {
    await db.doc(`setupInvites/${HASH}`).set({
      createdAt: Timestamp.fromMillis(NOW), expiresAt: Timestamp.fromMillis(NOW + 86_400_000), emailLock: null,
      claimedAt: null, claimId: null, usedAt: null, tenantId: null,
    })
    for (const p of ['tenants/ten_it00000001', 'users/uidIt1']) await db.doc(p).delete()
  })

  it('lets exactly one of many concurrent claims win', async () => {
    const wins = await Promise.all(Array.from({ length: 8 }, (_, i) => port().claimInvite({ hash: HASH, claimId: `c${i}`, email: 'a@b.test', nowMs: NOW })))
    expect(wins.filter(Boolean)).toHaveLength(1)
  })
  it('re-opens a claim after 10 minutes and refuses expired or unknown invites', async () => {
    expect(await port().claimInvite({ hash: HASH, claimId: 'a', email: 'a@b.test', nowMs: NOW })).toBe(true)
    expect(await port().claimInvite({ hash: HASH, claimId: 'b', email: 'a@b.test', nowMs: NOW + CLAIM_TTL_MS - 1 })).toBe(false)
    expect(await port().claimInvite({ hash: HASH, claimId: 'b', email: 'a@b.test', nowMs: NOW + CLAIM_TTL_MS })).toBe(true)
    expect(await port().claimInvite({ hash: HASH, claimId: 'c', email: 'a@b.test', nowMs: NOW + 2 * 86_400_000 })).toBe(false)
    expect(await port().claimInvite({ hash: 'f'.repeat(64), claimId: 'c', email: 'a@b.test', nowMs: NOW })).toBe(false)
  })
  it('release only clears our own claim', async () => {
    await port().claimInvite({ hash: HASH, claimId: 'mine', email: 'a@b.test', nowMs: NOW })
    await port().releaseClaim(HASH, 'someone-else')
    expect((await db.doc(`setupInvites/${HASH}`).get()).data()?.claimId).toBe('mine')
    await port().releaseClaim(HASH, 'mine')
    expect((await db.doc(`setupInvites/${HASH}`).get()).data()?.claimId).toBeNull()
  })
  it('commit writes tenant, admin, audit and the used marker atomically, and only for the claim holder', async () => {
    const input = {
      tenantId: 'ten_it00000001', tenantName: 'IT Co', timezone: 'Asia/Colombo',
      admin: { uid: 'uidIt1', name: 'Ada', email: 'ada@it.test', mustChangePassword: false, createdBy: 'setup' },
      actor: { uid: 'setup', role: 'system' as const },
    }
    await expect(port().commitSetup({ hash: HASH, claimId: 'nobody', input })).rejects.toBeInstanceOf(ClaimLostError)
    expect((await db.doc('tenants/ten_it00000001').get()).exists).toBe(false)

    await port().claimInvite({ hash: HASH, claimId: 'mine', email: 'ada@it.test', nowMs: NOW })
    await port().commitSetup({ hash: HASH, claimId: 'mine', input })
    expect((await db.doc('tenants/ten_it00000001').get()).data()).toMatchObject({ name: 'IT Co', status: 'active', retentionDays: 0, timezone: 'Asia/Colombo' })
    expect((await db.doc('users/uidIt1').get()).data()).toMatchObject({ role: 'admin', tenantId: 'ten_it00000001', createdBy: 'setup' })
    expect((await db.doc(`setupInvites/${HASH}`).get()).data()).toMatchObject({ tenantId: 'ten_it00000001', claimId: null })
    expect((await db.doc(`setupInvites/${HASH}`).get()).data()?.usedAt).toBeTruthy()
    // used: cannot be claimed or committed again
    expect(await port().claimInvite({ hash: HASH, claimId: 'again', email: 'a@b.test', nowMs: NOW + 1 })).toBe(false)
    await expect(port().commitSetup({ hash: HASH, claimId: 'mine', input })).rejects.toBeInstanceOf(ClaimLostError)
  })
})
