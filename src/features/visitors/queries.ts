import { collection, doc, limit, orderBy, query, where, type DocumentData } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { liveDoc, liveQuery, useLiveQuery } from '@/lib/liveQuery'
import { monthlyCap, planOf } from '@/lib/visitorLogic'
import { useSession } from '@/features/auth/useAuth'
import { useTenant, todayKey } from '@/features/passes/queries'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'
import type { Visitor, VisitorPass } from '@/types/visitors'

export const PASS_LIST_LIMIT = 300
export const VISITOR_LIST_LIMIT = 300
const INSIDE_LIMIT = 300

const toPass = (d: { id: string; data: () => DocumentData }): WithId<VisitorPass> => ({ ...(d.data() as VisitorPass), id: d.id })

/** The company's latest visitor passes, newest first (admin, supervisor). Live. */
export function useVisitorPasses() {
  const { claims } = useSession()
  return useLiveQuery(
    ['visitorPasses', claims.tenantId],
    liveQuery(
      query(collection(db, 'visitorPasses'), where('tenantId', '==', claims.tenantId), orderBy('issuedAt', 'desc'), limit(PASS_LIST_LIMIT)),
      (snap): WithId<VisitorPass>[] => snap.docs.map(toPass),
    ),
  )
}

/** The company's visitor records, most recently used first: the "returning visitor" search of the issue form (admin, supervisor). Live. */
export function useVisitors(enabled = true) {
  const { claims } = useSession()
  return useLiveQuery(
    ['visitors', claims.tenantId],
    liveQuery(
      query(collection(db, 'visitors'), where('tenantId', '==', claims.tenantId), orderBy('updatedAt', 'desc'), limit(VISITOR_LIST_LIMIT)),
      (snap): WithId<Visitor>[] => snap.docs.map((d) => ({ ...(d.data() as Visitor), id: d.id })),
    ),
    enabled,
  )
}

/**
 * Visitors who are inside right now. One listener for the gate, the on-site dashboard and the Yard Officer: the query
 * carries the clauses the rules require (tenant, and `status == checked_in` for the Yard Officer). Longest inside first.
 */
export function useInsideVisitors() {
  const { claims } = useSession()
  return useLiveQuery(
    ['visitorsInside', claims.tenantId],
    liveQuery(
      query(collection(db, 'visitorPasses'), where('tenantId', '==', claims.tenantId), where('status', '==', 'checked_in'), limit(INSIDE_LIMIT)),
      (snap): WithId<VisitorPass>[] => snap.docs.map(toPass).sort((a, b) => (a.checkInAt?.toMillis() ?? 0) - (b.checkInAt?.toMillis() ?? 0)),
    ),
  )
}

/** Vehicles inside right now (visits still checked in). A supervisor's query must carry their contractor (rules); others read the company's. */
export function useInsideVehicles() {
  const { claims } = useSession()
  const scoped = claims.role === 'supervisor'
  return useLiveQuery(
    ['vehiclesInside', claims.tenantId, scoped ? claims.contractorId : 'all'],
    liveQuery(
      query(
        collection(db, 'visits'),
        where('tenantId', '==', claims.tenantId),
        ...(scoped ? [where('contractorId', '==', claims.contractorId ?? '')] : []),
        where('status', '==', 'checked_in'),
        limit(INSIDE_LIMIT),
      ),
      (snap): WithId<Visit>[] =>
        snap.docs.map((d) => ({ ...(d.data() as Visit), id: d.id })).sort((a, b) => a.checkIn.timestamp.toMillis() - b.checkIn.timestamp.toMillis()),
    ),
    !scoped || claims.contractorId !== null,
  )
}

/** Passes counted this month (admin, supervisor): `visitorPassUsage/{tenantId}_{yyyyMM}`, 0 when nothing was issued yet. Live. */
export function usePassUsage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const month = todayKey(tenant.data).slice(0, 6)
  const result = useLiveQuery(
    ['visitorPassUsage', claims.tenantId, month],
    liveDoc(doc(db, 'visitorPassUsage', `${claims.tenantId}_${month}`), (snap): number => (snap.exists() ? Number((snap.data() as { count?: unknown }).count ?? 0) : 0)),
    !tenant.isPending,
  )
  return { ...result, month }
}

/** `used` against the plan's cap: Starter has a cap of 20 a month, the other plans (and a company with no plan recorded) none. */
export function usePlanUsage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const usage = usePassUsage()
  const cap = monthlyCap(planOf(tenant.data))
  const used = usage.data ?? 0
  return { cap, used, ready: usage.data !== undefined, full: cap !== null && used >= cap, error: usage.isError }
}
