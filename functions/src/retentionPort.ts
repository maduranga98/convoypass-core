import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { dataPort, toPass } from './ports.js'
import type { RetentionPort } from './retention.js'
import type { TenantData } from './types.js'

export const retentionPort = (): RetentionPort => {
  const db = getFirestore()
  return {
    listTenants: async () =>
      (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData & { retentionCursor?: string } })),
    listPassesBetween: async ({ tenantId, afterKey, beforeKey, limit }) => {
      let q = db.collection('passes').where('tenantId', '==', tenantId)
      if (afterKey) q = q.where('dateKey', '>', afterKey)
      const snap = await q.where('dateKey', '<', beforeKey).orderBy('dateKey').limit(limit).get()
      return snap.docs.map((d) => ({ id: d.id, pass: toPass(d.data() as Record<string, unknown>) }))
    },
    deleteEvidence: async (tenantId, vehicleId, dateKey) => {
      const prefix = `tenants/${tenantId}/passes/${vehicleId}/${dateKey}/`
      const bucket = getStorage().bucket()
      const [files] = await bucket.getFiles({ prefix })
      await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })))
      return files.length
    },
    markEvidenceDeleted: async (passId) => {
      await db.doc(`passes/${passId}`).update({ evidenceDeletedAt: FieldValue.serverTimestamp() })
    },
    setCursor: async (tenantId, key) => {
      await db.doc(`tenants/${tenantId}`).update({ retentionCursor: key })
    },
    // The one audit writer (ports.ts), so every entry has the same shape.
    writeAudit: (audit) => dataPort().writeAudit(audit),
  }
}
