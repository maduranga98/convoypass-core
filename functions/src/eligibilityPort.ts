import { FieldPath, getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { DatedField, EligibilityPort, StatusUpdate } from './eligibility.js'
import type { DriverData, TenantData, VehicleData } from './types.js'

/** Re-reads each document inside the transaction and skips it when a callable changed its dates since the job read it. */
async function apply(db: Firestore, collection: 'vehicles' | 'drivers', updates: StatusUpdate[]): Promise<number> {
  let written = 0
  await db.runTransaction(async (tx) => {
    written = 0
    const refs = updates.map((u) => db.doc(`${collection}/${u.id}`))
    const snaps = await tx.getAll(...refs)
    snaps.forEach((snap, i) => {
      const u = updates[i]
      if (!u || !snap.exists) return
      const current = snap.data() as Partial<Record<DatedField, string | null>>
      const unchanged = (Object.keys(u.dates) as DatedField[]).every((k) => (current[k] ?? null) === (u.dates[k] ?? null))
      if (!unchanged) return // the next run picks it up with the new dates
      tx.update(snap.ref, { eligibilityStatus: u.status })
      written++
    })
  })
  return written
}

export const eligibilityPort = (): EligibilityPort => {
  const db = getFirestore()
  const page = async <T>(collection: string, tenantId: string, after: string | null, limit: number) => {
    let q = db.collection(collection).where('tenantId', '==', tenantId).orderBy(FieldPath.documentId()).limit(limit)
    if (after) q = q.startAfter(after)
    return (await q.get()).docs.map((d) => ({ id: d.id, data: d.data() as T }))
  }
  return {
    listTenants: async () => (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData })),
    listVehicles: (tenantId, after, limit) => page<VehicleData>('vehicles', tenantId, after, limit),
    listDrivers: (tenantId, after, limit) => page<DriverData>('drivers', tenantId, after, limit),
    applyVehicleStatuses: (updates) => apply(db, 'vehicles', updates),
    applyDriverStatuses: (updates) => apply(db, 'drivers', updates),
  }
}
