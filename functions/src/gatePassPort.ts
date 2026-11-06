// Firestore implementation of the gate pass port (Admin SDK). The decisions live in gatePasses.ts; this file reads, writes and
// converts Timestamps. Every write that touches a pass also writes its audit entry in the same transaction or batch.
import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { pairingKey, qualificationId, type GatePassData, type GatePassRecord, type QualificationEntry, type QualificationMeta } from './gatePassLogic.js'
import type { CandidatePair, GatePassPatch, GatePassPort } from './gatePasses.js'
import { newAuditDoc } from './ports.js'
import type { AuditEntry, TenantData } from './types.js'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

/** Stored pass -> GatePassRecord with every timestamp as milliseconds. */
export function toGatePass(id: string, raw: DocumentData): GatePassRecord {
  const re = raw.reactivation as { by: { uid: string; name: string }; at: unknown; previousReason: GatePassData['blockedReason'] } | null | undefined
  return {
    ...(raw as GatePassData),
    id,
    issuedAt: ms(raw.issuedAt) ?? 0,
    blockedAt: ms(raw.blockedAt),
    expiredAt: ms(raw.expiredAt),
    reactivation: re ? { ...re, at: ms(re.at) ?? 0 } : null,
    createdAt: ms(raw.createdAt) ?? undefined,
    updatedAt: ms(raw.updatedAt) ?? undefined,
  }
}

/** Patch -> stored fields (milliseconds become Timestamps, `undefined` is dropped). */
function storedPatch(patch: GatePassPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if ((k === 'blockedAt' || k === 'expiredAt' || k === 'issuedAt') && typeof v === 'number') out[k] = ts(v)
    else if (k === 'reactivation' && v !== null) out[k] = { ...(v as object), at: ts((v as { at: number }).at) }
    else out[k] = v
  }
  return out
}

const withAudit = (db: Firestore, audit: AuditEntry) => ({ ref: newAuditDoc(db), data: { ...audit, createdAt: FieldValue.serverTimestamp() } })

export const gatePassPort = (): GatePassPort => {
  const db = getFirestore()
  const passes = db.collection('gatePasses')

  return {
    getPass: async (passId) => {
      const snap = await passes.doc(passId).get()
      return snap.exists ? toGatePass(snap.id, snap.data() as DocumentData) : null
    },

    lookupForPairing: async (tenantId, vehicleId, driverId, month) => {
      const snap = await passes.doc(`${month}_${vehicleId}_${driverId}`).get()
      const current = snap.exists && (snap.data() as DocumentData).tenantId === tenantId ? toGatePass(snap.id, snap.data() as DocumentData) : null
      if (current) return { current, hadEarlier: false }
      // Equality on the pairing + a range on the month; the composite index is in firestore.indexes.json.
      const earlier = await passes
        .where('tenantId', '==', tenantId)
        .where('vehicleId', '==', vehicleId)
        .where('driverId', '==', driverId)
        .where('month', '<', month)
        .limit(1)
        .select()
        .get()
      return { current: null, hadEarlier: !earlier.empty }
    },

    issueTx: ({ passId, pass, audit }) =>
      db.runTransaction(async (tx) => {
        const ref = passes.doc(passId)
        const snap = await tx.get(ref)
        if (snap.exists) return { created: false, pass: toGatePass(snap.id, snap.data() as DocumentData) }
        tx.create(ref, { ...storedPatch(pass), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        const a = withAudit(db, audit)
        tx.create(a.ref, a.data)
        return { created: true, pass: { ...pass, id: passId } }
      }),

    updateTx: ({ passId, plan }) =>
      db.runTransaction(async (tx) => {
        const ref = passes.doc(passId)
        const snap = await tx.get(ref)
        const current = snap.exists ? toGatePass(snap.id, snap.data() as DocumentData) : null
        const planned = plan(current)
        if (!planned || !current) return { written: false, pass: current }
        tx.update(ref, { ...storedPatch(planned.patch), updatedAt: FieldValue.serverTimestamp() })
        const a = withAudit(db, planned.audit)
        tx.create(a.ref, a.data)
        return { written: true, pass: { ...current, ...planned.patch } }
      }),

    listActive: async (tenantId, scope) => {
      let q = passes.where('tenantId', '==', tenantId)
      if (scope.vehicleId) q = q.where('vehicleId', '==', scope.vehicleId)
      if (scope.driverId) q = q.where('driverId', '==', scope.driverId)
      const snap = await q.where('status', '==', 'active').limit(500).get()
      return snap.docs.map((d) => toGatePass(d.id, d.data()))
    },

    listTenants: async () => (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData })),

    listOver: async (tenantId, currentMonth, limit) => {
      const snap = await passes
        .where('tenantId', '==', tenantId)
        .where('status', 'in', ['active', 'blocked'])
        .where('month', '<', currentMonth)
        .orderBy('month')
        .limit(limit)
        .select()
        .get()
      return snap.docs.map((d) => d.id)
    },

    expireTx: (tenantId, ids, currentMonth, nowMs) => {
      let expired = 0
      return db
        .runTransaction(async (tx) => {
          expired = 0
          const snaps = await tx.getAll(...ids.map((id) => passes.doc(id)))
          for (const snap of snaps) {
            if (!snap.exists) continue
            const p = snap.data() as DocumentData
            if (p.tenantId !== tenantId || (p.status !== 'active' && p.status !== 'blocked') || (p.month as string) >= currentMonth) continue
            // `blockedReason` stays: the end of the month does not erase that the pass had been stopped.
            tx.update(snap.ref, { status: 'expired', expiredAt: ts(nowMs), updatedAt: FieldValue.serverTimestamp() })
            expired++
          }
          if (expired > 0) {
            const a = withAudit(db, {
              tenantId,
              action: 'gatePass.expire',
              actorUid: 'system',
              actorRole: 'system',
              targetType: 'gatePass',
              targetId: currentMonth,
              meta: { count: expired, beforeMonth: currentMonth },
            })
            tx.create(a.ref, a.data)
          }
        })
        .then(() => expired)
    },

    markRollover: async (tenantId, month) => {
      await db.doc(`tenants/${tenantId}`).update({ gatePassRolloverMonth: month })
    },

    listCandidatePairs: async (tenantId, max) => {
      const [vehicles, contractors, drivers] = await Promise.all([
        db.collection('vehicles').where('tenantId', '==', tenantId).where('status', '==', 'active').limit(max + 1).get(),
        db.collection('contractors').where('tenantId', '==', tenantId).get(),
        db.collection('users').where('tenantId', '==', tenantId).where('role', '==', 'driver').where('status', '==', 'active').get(),
      ])
      const contractorName = new Map<string, string>()
      for (const c of contractors.docs) {
        const d = c.data() as { status?: string; name?: string }
        if (d.status === 'active') contractorName.set(c.id, d.name ?? '')
      }
      const driverName = new Map(drivers.docs.map((d) => [d.id, (d.data() as { name?: string }).name ?? '']))
      const pairs: CandidatePair[] = []
      for (const v of vehicles.docs.slice().sort((a, b) => a.id.localeCompare(b.id))) {
        const d = v.data() as { contractorId: string; plateNo: string; assignedDriverIds?: string[] }
        const cName = contractorName.get(d.contractorId)
        if (cName === undefined) continue
        for (const driverId of d.assignedDriverIds ?? []) {
          const name = driverName.get(driverId)
          if (name === undefined) continue
          pairs.push({ vehicleId: v.id, driverId, contractorId: d.contractorId, contractorName: cName, plateNo: d.plateNo, driverName: name })
        }
      }
      return { pairs: pairs.slice(0, max), truncated: vehicles.size > max || pairs.length > max }
    },

    listPassKeys: async (tenantId, month) => {
      const snap = await passes.where('tenantId', '==', tenantId).where('month', '==', month).select('vehicleId', 'driverId').get()
      return new Set(snap.docs.map((d) => pairingKey(d.get('vehicleId') as string, d.get('driverId') as string)))
    },

    replaceQualification: async (tenantId, month, meta, entries) => {
      const parent = db.doc(`monthEndQualification/${qualificationId(tenantId, month)}`)
      const existing = await parent.collection('entries').select().get()
      const keep = new Set(entries.map((e) => pairingKey(e.vehicleId, e.driverId)))
      const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = []
      for (const d of existing.docs) if (!keep.has(d.id)) ops.push((b) => b.delete(d.ref))
      for (const e of entries) ops.push((b) => b.set(parent.collection('entries').doc(pairingKey(e.vehicleId, e.driverId)), { ...e, computedAt: ts(e.computedAt) }))
      // Entries first, the summary last: a reader that sees the new summary sees its entries.
      for (let i = 0; i < ops.length; i += 450) {
        const b = db.batch()
        for (const op of ops.slice(i, i + 450)) op(b)
        await b.commit()
      }
      await parent.set({ ...meta, computedAt: ts(meta.computedAt) })
    },

    removeQualificationEntries: async (tenantId, month, keys) => {
      const parent = db.doc(`monthEndQualification/${qualificationId(tenantId, month)}`)
      for (let i = 0; i < keys.length; i += 450) {
        const b = db.batch()
        for (const k of keys.slice(i, i + 450)) b.delete(parent.collection('entries').doc(k))
        await b.commit()
      }
    },
  }
}

export type { QualificationEntry, QualificationMeta }
