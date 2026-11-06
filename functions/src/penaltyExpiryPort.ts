import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { expiryAudit, isDue, type PenaltyExpiryPort } from './penaltyExpiry.js'
import { newAuditDoc, toPenalty } from './ports.js'

export const penaltyExpiryPort = (): PenaltyExpiryPort => {
  const db = getFirestore()
  return {
    // Equality on status + a range on the end date: permanent penalties have no `duration.endDate` and never match.
    listDue: async (nowMs, limit) => {
      const snap = await db
        .collection('penalties')
        .where('status', '==', 'active')
        .where('duration.endDate', '<', Timestamp.fromMillis(nowMs))
        .orderBy('duration.endDate')
        .limit(limit)
        .get()
      return snap.docs.map((d) => ({ id: d.id, data: toPenalty(d.data() as Record<string, unknown>) }))
    },
    expire: async (ids, nowMs) => {
      let expired = 0
      await db.runTransaction(async (tx) => {
        expired = 0
        const snaps = await tx.getAll(...ids.map((id) => db.doc(`penalties/${id}`)))
        for (const snap of snaps) {
          if (!snap.exists) continue
          const p = toPenalty(snap.data() as Record<string, unknown>)
          if (!isDue(p, nowMs)) continue // revoked or changed since it was listed
          tx.update(snap.ref, { status: 'expired', expiredAt: Timestamp.fromMillis(nowMs), updatedAt: FieldValue.serverTimestamp() })
          tx.create(newAuditDoc(db), { ...expiryAudit(p, snap.id), createdAt: FieldValue.serverTimestamp() })
          expired++
        }
      })
      return expired
    },
  }
}
