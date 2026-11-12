// Firestore implementation of the visitor port (Admin SDK). The decisions live in visitors.ts; this file reads, writes and
// converts Timestamps. Every write that touches a pass also writes its audit entry in the same transaction or batch.
import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { newAuditDoc } from './ports.js'
import type { AuditEntry, TenantData, VisitorData, VisitorPassData } from './types.js'
import { isOverstay } from './visitorLogic.js'
import type { VisitorPassRecord, VisitorPort, VisitorRecord } from './visitors.js'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

const PASS_TIME_FIELDS = ['issuedAt', 'validFrom', 'validUntil', 'checkInAt', 'checkOutAt', 'dwellWarningAt', 'revokedAt', 'expiredAt'] as const

/** Stored pass -> VisitorPassRecord with every timestamp as milliseconds. */
export function toVisitorPass(id: string, raw: DocumentData): VisitorPassRecord {
  const out: Record<string, unknown> = { ...raw, id }
  for (const k of PASS_TIME_FIELDS) out[k] = ms(raw[k])
  out.issuedAt = ms(raw.issuedAt) ?? 0
  out.validFrom = ms(raw.validFrom) ?? 0
  out.validUntil = ms(raw.validUntil) ?? 0
  return out as unknown as VisitorPassRecord
}

export function toVisitor(id: string, raw: DocumentData): VisitorRecord {
  return { ...(raw as VisitorData), id, createdAt: ms(raw.createdAt) ?? 0, updatedAt: ms(raw.updatedAt) ?? 0 }
}

/** Pass fields -> stored (milliseconds become Timestamps, `undefined` is dropped). */
function storedPass(p: Partial<VisitorPassData>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    out[k] = (PASS_TIME_FIELDS as readonly string[]).includes(k) && typeof v === 'number' ? ts(v) : v
  }
  return out
}

const storedVisitor = (v: Partial<VisitorData>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...v }
  if (typeof v.createdAt === 'number') out.createdAt = ts(v.createdAt)
  if (typeof v.updatedAt === 'number') out.updatedAt = ts(v.updatedAt)
  return out
}

const withAudit = (db: Firestore, audit: AuditEntry) => ({ ref: newAuditDoc(db), data: { ...audit, createdAt: FieldValue.serverTimestamp() } })

/** The slice of a pass that is copied from the visitor record. */
const passCopyOf = (patch: Partial<VisitorData>): Record<string, unknown> => ({
  ...(patch.fullName !== undefined ? { visitorName: patch.fullName } : {}),
  ...(patch.organization !== undefined ? { visitorOrganization: patch.organization } : {}),
  ...(patch.photoPath !== undefined ? { photoPath: patch.photoPath } : {}),
})

export const visitorPort = (): VisitorPort => {
  const db = getFirestore()
  const passes = db.collection('visitorPasses')
  const visitors = db.collection('visitors')

  return {
    issueTx: ({ passId, visitorId, tenantId, month, code, plan }) =>
      db.runTransaction(async (tx) => {
        const passRef = passes.doc(passId)
        const visitorRef = visitors.doc(visitorId)
        const usageRef = db.doc(`visitorPassUsage/${tenantId}_${month}`)
        const guardRef = db.doc(`visitorPassCodes/${tenantId}_${code}`)
        const [pSnap, vSnap, uSnap, gSnap] = await tx.getAll(passRef, visitorRef, usageRef, guardRef)
        const planned = plan({
          existingPass: pSnap?.exists ? toVisitorPass(pSnap.id, pSnap.data() as DocumentData) : null,
          visitor: vSnap?.exists ? toVisitor(vSnap.id, vSnap.data() as DocumentData) : null,
          used: uSnap?.exists ? Number((uSnap.data() as { count?: unknown }).count ?? 0) : 0,
          codeTaken: gSnap?.exists ?? false,
        })
        if (planned.kind !== 'write') return planned
        tx.create(passRef, { ...storedPass(planned.pass), createdAt: FieldValue.serverTimestamp() })
        tx.create(guardRef, { tenantId, passId })
        if (planned.visitorIsNew) tx.create(visitorRef, storedVisitor(planned.visitor))
        else {
          // A returning visitor keeps who created them and when; everything else follows this issue.
          const { fullName, phone, idNumber, idKey, organization, photoPath, updatedAt } = planned.visitor
          tx.update(visitorRef, storedVisitor({ fullName, phone, idNumber, idKey, organization, photoPath, updatedAt }))
        }
        tx.set(usageRef, { tenantId, yearMonth: month, count: planned.usedAfter, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        for (const a of planned.audits) {
          const { ref, data } = withAudit(db, a)
          tx.create(ref, data)
        }
        return planned
      }),

    getPass: async (passId) => {
      const snap = await passes.doc(passId).get()
      return snap.exists ? toVisitorPass(snap.id, snap.data() as DocumentData) : null
    },

    findPassByCode: async (tenantId, code) => {
      const snap = await passes.where('tenantId', '==', tenantId).where('passCode', '==', code).limit(1).get()
      const doc = snap.docs[0]
      return doc ? toVisitorPass(doc.id, doc.data()) : null
    },

    getVisitor: async (visitorId) => {
      const snap = await visitors.doc(visitorId).get()
      return snap.exists ? toVisitor(snap.id, snap.data() as DocumentData) : null
    },

    updatePassTx: ({ passId, plan }) =>
      db.runTransaction(async (tx) => {
        const ref = passes.doc(passId)
        const snap = await tx.get(ref)
        const current = snap.exists ? toVisitorPass(snap.id, snap.data() as DocumentData) : null
        const planned = plan(current)
        if (!planned || !current) return { written: false, pass: current }
        tx.update(ref, { ...storedPass(planned.patch), updatedAt: FieldValue.serverTimestamp() })
        const { ref: auditRef, data } = withAudit(db, planned.audit)
        tx.create(auditRef, data)
        return { written: true, pass: { ...current, ...planned.patch } }
      }),

    updateVisitorTx: ({ visitorId, tenantId, patch, audit }) =>
      db.runTransaction(async (tx) => {
        const ref = visitors.doc(visitorId)
        const live = await tx.get(passes.where('tenantId', '==', tenantId).where('visitorId', '==', visitorId).where('status', 'in', ['active', 'checked_in']).limit(50))
        const snap = await tx.get(ref)
        if (!snap.exists || (snap.data() as DocumentData).tenantId !== tenantId) return
        tx.update(ref, { ...storedVisitor(patch), updatedAt: FieldValue.serverTimestamp() })
        const copy = passCopyOf(patch)
        if (Object.keys(copy).length > 0) for (const d of live.docs) tx.update(d.ref, { ...copy, updatedAt: FieldValue.serverTimestamp() })
        const { ref: auditRef, data } = withAudit(db, audit)
        tx.create(auditRef, data)
      }),

    updateSettingsTx: async ({ tenantId, settings, audit }) => {
      const batch = db.batch()
      batch.set(db.doc(`tenants/${tenantId}`), { visitorSettings: settings, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      const { ref, data } = withAudit(db, audit)
      batch.create(ref, data)
      await batch.commit()
    },

    usedThisMonth: async (tenantId, month) => {
      const snap = await db.doc(`visitorPassUsage/${tenantId}_${month}`).get()
      return snap.exists ? Number((snap.data() as { count?: unknown }).count ?? 0) : 0
    },

    listTenants: async () => (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData })),

    listExpired: async (tenantId, nowMs, limit) => {
      const snap = await passes.where('tenantId', '==', tenantId).where('status', '==', 'active').where('validUntil', '<', ts(nowMs)).orderBy('validUntil').limit(limit).get()
      return snap.docs.map((d) => d.id)
    },

    expireTx: async (tenantId, ids, nowMs) => {
      let expired = 0
      await db.runTransaction(async (tx) => {
        expired = 0
        const snaps = await tx.getAll(...ids.map((id) => passes.doc(id)))
        for (const snap of snaps) {
          if (!snap.exists) continue
          const v = snap.data() as { status?: string; validUntil?: Timestamp }
          const until = v.validUntil?.toMillis()
          if (v.status !== 'active' || until === undefined || until >= nowMs) continue
          tx.update(snap.ref, { status: 'expired', expiredAt: ts(nowMs), updatedAt: FieldValue.serverTimestamp() })
          expired++
        }
        if (expired > 0) {
          const { ref, data } = withAudit(db, { tenantId, action: 'visitorPass.expire', actorUid: 'system', actorRole: 'system', targetType: 'visitorPass', targetId: `batch_${nowMs}`, meta: { count: expired } })
          tx.create(ref, data)
        }
      })
      return expired
    },

    listUnflaggedInside: async (tenantId, limit) => {
      const snap = await passes.where('tenantId', '==', tenantId).where('status', '==', 'checked_in').where('dwellWarning', '==', false).limit(limit).get()
      return snap.docs.map((d) => toVisitorPass(d.id, d.data()))
    },

    flagTx: async (tenantId, ids, nowMs) => {
      let flagged = 0
      await db.runTransaction(async (tx) => {
        flagged = 0
        const snaps = await tx.getAll(...ids.map((id) => passes.doc(id)))
        for (const snap of snaps) {
          if (!snap.exists) continue
          const pass = toVisitorPass(snap.id, snap.data() as DocumentData)
          if (pass.dwellWarning || !isOverstay(pass, nowMs)) continue // checked out in between, or already flagged
          tx.update(snap.ref, { dwellWarning: true, dwellWarningAt: ts(nowMs), updatedAt: FieldValue.serverTimestamp() })
          const { ref, data } = withAudit(db, { tenantId, action: 'visitorPass.dwellWarning', actorUid: 'system', actorRole: 'system', targetType: 'visitorPass', targetId: snap.id, meta: { limitMinutes: pass.maxDwellMinutes } })
          tx.create(ref, data)
          flagged++
        }
      })
      return flagged
    },
  }
}
