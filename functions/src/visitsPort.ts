// Firestore implementation of the visit ports (Admin SDK). The pure decisions live in visits.ts; this file only reads,
// writes and converts Timestamps. Every write that touches a visit also touches the driver lock and the audit log in the
// same transaction.
import { FieldValue, getFirestore, Timestamp, type DocumentData, type Query } from 'firebase-admin/firestore'
import { gatePassPort } from './gatePassPort.js'
import { newAuditDoc } from './ports.js'
import type { CheckInContext, VisitPort, VisitRecord, VisitScope } from './visits.js'
import type { DriverData, UserData, VisitData } from './types.js'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

/** Stored visit -> VisitData with every timestamp as milliseconds. */
export function toVisit(id: string, raw: DocumentData): VisitRecord {
  const checkIn = raw.checkIn as Omit<VisitData['checkIn'], 'timestamp'> & { timestamp: unknown }
  const unloading = raw.unloadingCheck as (Omit<NonNullable<VisitData['unloadingCheck']>, 'timestamp'> & { timestamp: unknown }) | null | undefined
  const checkOut = raw.checkOut as (Omit<NonNullable<VisitData['checkOut']>, 'timestamp'> & { timestamp: unknown }) | null | undefined
  return {
    ...(raw as VisitData),
    id,
    checkIn: { ...checkIn, timestamp: ms(checkIn.timestamp) ?? 0 },
    unloadingCheck: unloading ? { ...unloading, timestamp: ms(unloading.timestamp) ?? 0 } : null,
    checkOut: checkOut ? { ...checkOut, timestamp: ms(checkOut.timestamp) ?? 0 } : null,
    dwellWarningAt: ms(raw.dwellWarningAt),
  }
}

const storedCheckIn = (c: VisitData['checkIn']) => ({ ...c, timestamp: ts(c.timestamp) })
const storedUnloading = (u: NonNullable<VisitData['unloadingCheck']>) => ({ ...u, timestamp: ts(u.timestamp) })
const storedCheckOut = (c: NonNullable<VisitData['checkOut']>) => ({ ...c, timestamp: ts(c.timestamp) })

export const visitPort = (): VisitPort => {
  const db = getFirestore()
  const visits = db.collection('visits')

  const scoped = (scope: VisitScope): Query => {
    const q = visits.where('tenantId', '==', scope.tenantId)
    return scope.contractorId ? q.where('contractorId', '==', scope.contractorId) : q
  }

  const gatePasses = gatePassPort()
  return {
    lookupForPairing: gatePasses.lookupForPairing,
    getVisit: async (visitId) => {
      const snap = await visits.doc(visitId).get()
      return snap.exists ? toVisit(snap.id, snap.data() as DocumentData) : null
    },

    checkInTx: ({ visitId, tenantId, vehicleId, driverId, plan }) =>
      db.runTransaction(async (tx) => {
        const visitRef = visits.doc(visitId)
        const driverRef = db.doc(`drivers/${driverId}`)
        const userRef = db.doc(`users/${driverId}`)
        const [vSnap, dSnap, uSnap] = await tx.getAll(visitRef, driverRef, userRef)
        // The vehicle's active visit is a query inside the transaction, so two concurrent check-ins cannot both pass.
        const activeSnap = await tx.get(
          visits.where('tenantId', '==', tenantId).where('vehicleId', '==', vehicleId).where('status', '==', 'checked_in').limit(1),
        )
        const first = activeSnap.docs[0]
        const ctx: CheckInContext = {
          existing: vSnap?.exists ? toVisit(vSnap.id, vSnap.data() as DocumentData) : null,
          vehicleActive: first ? toVisit(first.id, first.data()) : null,
          driver: dSnap?.exists ? (dSnap.data() as DriverData) : null,
          driverUser: uSnap?.exists ? (uSnap.data() as UserData) : null,
        }
        const planned = plan(ctx)
        if (planned.kind === 'replay') return planned
        const v = planned.visit
        tx.create(visitRef, {
          ...v,
          checkIn: storedCheckIn(v.checkIn),
          unloadingCheck: null,
          checkOut: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        const lock = { driverOnDutyLock: true, activeVisitId: visitId, updatedAt: FieldValue.serverTimestamp() }
        if (ctx.driver) {
          tx.update(driverRef, lock)
        } else if (ctx.driverUser && ctx.driverUser.contractorId) {
          // A driver that predates Module 2 has no `drivers` doc: create it from the `users` record (the same mirror a first edit writes).
          tx.set(driverRef, {
            tenantId: ctx.driverUser.tenantId,
            contractorId: ctx.driverUser.contractorId,
            name: ctx.driverUser.name,
            phone: ctx.driverUser.phone,
            status: ctx.driverUser.status,
            ...lock,
          })
        }
        tx.create(newAuditDoc(db), { ...planned.audit, createdAt: FieldValue.serverTimestamp() })
        return planned
      }),

    checkOutTx: ({ visitId, plan }) =>
      db.runTransaction(async (tx) => {
        const visitRef = visits.doc(visitId)
        const vSnap = await tx.get(visitRef)
        const visit = vSnap.exists ? toVisit(vSnap.id, vSnap.data() as DocumentData) : null
        const planned = plan(visit)
        if (planned.kind === 'replay' || !visit) return planned
        const driverRef = db.doc(`drivers/${visit.driverId}`)
        const dSnap = await tx.get(driverRef)
        tx.update(visitRef, {
          status: 'checked_out',
          checkOut: storedCheckOut(planned.checkOut),
          driverOnDutyLock: false,
          updatedAt: FieldValue.serverTimestamp(),
        })
        // Only the visit that holds the lock releases it.
        if (dSnap.exists && (dSnap.data() as DriverData).activeVisitId === visitId) {
          tx.update(driverRef, { driverOnDutyLock: false, activeVisitId: null, updatedAt: FieldValue.serverTimestamp() })
        }
        tx.create(newAuditDoc(db), { ...planned.audit, createdAt: FieldValue.serverTimestamp() })
        return planned
      }),

    unloadTx: ({ visitId, plan }) =>
      db.runTransaction(async (tx) => {
        const visitRef = visits.doc(visitId)
        const vSnap = await tx.get(visitRef)
        const planned = plan(vSnap.exists ? toVisit(vSnap.id, vSnap.data() as DocumentData) : null)
        tx.update(visitRef, { unloadingCheck: storedUnloading(planned.unloadingCheck), updatedAt: FieldValue.serverTimestamp() })
        tx.create(newAuditDoc(db), { ...planned.audit, createdAt: FieldValue.serverTimestamp() })
        return planned
      }),

    countStage: async (scope, stage, dateKey) =>
      (await scoped(scope).where(`${stage}.dateKey`, '==', dateKey).count().get()).data().count,
    countActive: async (scope, { awaitingUnload }) => {
      const q = scoped(scope).where('status', '==', 'checked_in')
      return (await (awaitingUnload ? q.where('unloadingCheck', '==', null) : q).count().get()).data().count
    },
    listDwell: async (scope, limit) => {
      const snap = await scoped(scope)
        .where('status', '==', 'checked_in')
        .where('dwellWarning', '==', true)
        .orderBy('checkIn.timestamp')
        .limit(limit)
        .get()
      return snap.docs.map((d) => toVisit(d.id, d.data()))
    },
    countPenaltiesIssued: async (scope, fromMs, toMs) => {
      const base = db.collection('penalties').where('tenantId', '==', scope.tenantId)
      const q = scope.contractorId ? base.where('contractorId', '==', scope.contractorId) : base
      return (await q.where('issuedAt', '>=', ts(fromMs)).where('issuedAt', '<=', ts(toMs)).count().get()).data().count
    },
  }
}
