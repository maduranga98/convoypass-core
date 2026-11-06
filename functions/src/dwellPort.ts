import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { dwellAudit, type DwellPort } from './dwell.js'
import { newAuditDoc } from './ports.js'
import { dwellLimitHoursOf } from './visitLogic.js'
import type { TenantData } from './types.js'

export const dwellPort = (): DwellPort => {
  const db = getFirestore()
  return {
    listTenants: async () => (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData })),
    listOverdue: async (tenantId, cutoffMs, limit) => {
      const snap = await db
        .collection('visits')
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'checked_in')
        .where('dwellWarning', '==', false)
        .where('checkIn.timestamp', '<=', Timestamp.fromMillis(cutoffMs))
        .orderBy('checkIn.timestamp')
        .limit(limit)
        .get()
      return snap.docs.map((d) => d.id)
    },
    flag: async (tenantId, ids, cutoffMs, nowMs) => {
      let flagged = 0
      await db.runTransaction(async (tx) => {
        flagged = 0
        const tenantSnap = await tx.get(db.doc(`tenants/${tenantId}`))
        const limitHours = dwellLimitHoursOf(tenantSnap.data() as TenantData | undefined)
        const snaps = await tx.getAll(...ids.map((id) => db.doc(`visits/${id}`)))
        for (const snap of snaps) {
          if (!snap.exists) continue
          const v = snap.data() as { status?: string; dwellWarning?: boolean; checkIn?: { timestamp?: Timestamp } }
          const at = v.checkIn?.timestamp?.toMillis()
          if (v.status !== 'checked_in' || v.dwellWarning === true || at === undefined || at > cutoffMs) continue
          tx.update(snap.ref, { dwellWarning: true, dwellWarningAt: Timestamp.fromMillis(nowMs), updatedAt: FieldValue.serverTimestamp() })
          tx.create(newAuditDoc(db), { ...dwellAudit(tenantId, snap.id, limitHours), createdAt: FieldValue.serverTimestamp() })
          flagged++
        }
      })
      return flagged
    },
  }
}
