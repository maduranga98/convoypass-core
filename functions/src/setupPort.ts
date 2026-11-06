import { randomUUID } from 'node:crypto'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { ClaimLostError, type SetupPort } from './setup.js'
import { isClaimable } from './tenants/inviteCode.js'
import { provisionTenant } from './tenants/tenantDefaults.js'

interface InviteDoc {
  expiresAt?: Timestamp
  emailLock?: string
  companyHint?: string
  claimedAt?: Timestamp | null
  claimId?: string | null
  usedAt?: Timestamp | null
}

const times = (d: InviteDoc) => ({
  expiresAtMs: d.expiresAt?.toMillis() ?? 0,
  usedAtMs: d.usedAt?.toMillis() ?? null,
  claimedAtMs: d.claimedAt?.toMillis() ?? null,
})

/** `setupInvites/{sha256hex(code)}`: Admin SDK only (rules deny every client). */
export const setupPort = (): SetupPort => {
  const db = getFirestore()
  const ref = (hash: string) => db.doc(`setupInvites/${hash}`)
  return {
    lookupInvite: async (hash, nowMs) => {
      const d = (await ref(hash).get()).data() as InviteDoc | undefined
      if (!d) return null
      const t = times(d)
      return {
        usable: t.usedAtMs === null && t.expiresAtMs > nowMs,
        ...(d.companyHint ? { companyHint: d.companyHint } : {}),
        ...(d.emailLock ? { emailLock: d.emailLock } : {}),
      }
    },
    claimInvite: ({ hash, claimId, email, nowMs }) =>
      db.runTransaction(async (tx) => {
        const d = (await tx.get(ref(hash))).data() as InviteDoc | undefined
        if (!d || !isClaimable(times(d), nowMs)) return false
        if (d.emailLock && d.emailLock !== email) return false
        tx.update(ref(hash), { claimedAt: Timestamp.fromMillis(nowMs), claimId })
        return true
      }),
    releaseClaim: (hash, claimId) =>
      db.runTransaction(async (tx) => {
        const d = (await tx.get(ref(hash))).data() as InviteDoc | undefined
        if (d && d.usedAt == null && d.claimId === claimId) tx.update(ref(hash), { claimedAt: null, claimId: null })
      }),
    commitSetup: ({ hash, claimId, input }) =>
      db.runTransaction(async (tx) => {
        const d = (await tx.get(ref(hash))).data() as InviteDoc | undefined
        if (!d || d.usedAt != null || d.claimId !== claimId) throw new ClaimLostError()
        // create() fails if the tenant or user exists: setup can never write into an existing tenant.
        provisionTenant(db, tx, { ...input, createdAt: FieldValue.serverTimestamp() })
        tx.update(ref(hash), { usedAt: FieldValue.serverTimestamp(), tenantId: input.tenantId, claimId: null })
      }),
  }
}

export const newClaimId = (): string => randomUUID()
