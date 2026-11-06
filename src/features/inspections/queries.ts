import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { liveQuery, useLiveQuery } from '@/lib/liveQuery'
import type { Vehicle, WithId } from '@/types'
import type { Inspection } from '@/types/inspections'
import { useScope, type Scope } from '@/features/shared/scope'
import { REINSPECTION_STATUSES } from './model'

export const HISTORY_LIMIT = 50

/**
 * Every inspection of one vehicle, newest first, live (the triggers that cancel a clearance run on the server). The query
 * carries the clauses the rules require: the tenant, and for a supervisor their own contractor. Admin (oversight, read
 * only) and the Safety Officer read the whole company.
 */
export function useVehicleInspections(scope: Scope, vehicleId: string | undefined) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(
    ['inspections', tenantId, contractorId ?? 'all', vehicleId],
    liveQuery(
      query(
        collection(db, 'inspections'),
        where('tenantId', '==', tenantId),
        ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
        where('vehicleId', '==', vehicleId ?? ''),
        orderBy('inspectedAt', 'desc'),
        limit(HISTORY_LIMIT),
      ),
      (snap): WithId<Inspection>[] => snap.docs.map((d) => ({ ...(d.data() as Inspection), id: d.id })),
    ),
    ready && vehicleId !== undefined,
  )
}

/**
 * The vehicles that need another look: clearance cancelled, or the last inspection rejected. Read straight from the
 * vehicles (they carry a copy of the current clearance), longest waiting first. Live, because the cancelling triggers run
 * server side.
 */
export function useReinspectionVehicles() {
  const { tenantId } = useScope('admin')
  return useLiveQuery(
    ['reinspection', tenantId],
    liveQuery(
      query(collection(db, 'vehicles'), where('tenantId', '==', tenantId), where('clearance.status', 'in', [...REINSPECTION_STATUSES]), limit(500)),
      (snap): WithId<Vehicle>[] =>
        snap.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id })).sort((a, b) => (a.clearance?.at ?? 0) - (b.clearance?.at ?? 0)),
    ),
  )
}
