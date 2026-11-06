import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { DEFAULT_REJECTION_REASONS, type RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import { db } from '@/lib/firebase'
import { liveDoc, liveQuery, useLiveQuery } from '@/lib/liveQuery'
import type { Tenant, Vehicle, WithId } from '@/types'
import type { PassDoc, PassWithId } from '@/types/passes'

/** The member's own tenant document (rules allow reading it). */
export function useTenant(tenantId: string) {
  return useLiveQuery(['tenant', tenantId], liveDoc(doc(db, 'tenants', tenantId), (snap): Tenant | null => (snap.exists() ? (snap.data() as Tenant) : null)))
}

export const todayKey = (tenant: Tenant | null | undefined): string => dateKey(tenant?.timezone ?? DEFAULT_TIMEZONE)

/** Vehicles assigned to this driver (allowed by the rules because the query asks for exactly that). */
export function useMyVehicles(tenantId: string, uid: string) {
  return useLiveQuery(
    ['myVehicles', tenantId, uid],
    liveQuery(
      query(collection(db, 'vehicles'), where('tenantId', '==', tenantId), where('assignedDriverIds', 'array-contains', uid)),
      (snap): WithId<Vehicle>[] => snap.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id })).sort((a, b) => a.plateKey.localeCompare(b.plateKey)),
    ),
  )
}

export const RECENT_PASSES = 10
/** Enough history to find today's pass for every vehicle, not just the 10 shown. */
const PASS_FETCH = 30

export type MyPasses = { retry: () => void } & (
  | { isPending: true; isError: false; data: undefined }
  | { isPending: false; isError: true; data: PassWithId[] | undefined }
  | { isPending: false; isError: false; data: PassWithId[] }
)

/**
 * This driver's latest passes, newest first, live: an approval or a rejection shows up on the home screen by itself.
 * The query asks for exactly what the rules allow (own passes in the own tenant) and unsubscribes on unmount.
 */
export function useMyPasses(tenantId: string, uid: string): MyPasses {
  const [state, setState] = useState<{ key: string; data?: PassWithId[]; error?: boolean }>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const key = `${tenantId}|${uid}|${attempt}`

  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'passes'),
        where('tenantId', '==', tenantId),
        where('driverId', '==', uid),
        orderBy('submittedAt', 'desc'),
        limit(PASS_FETCH),
      ),
      (snap) => setState({ key, data: snap.docs.map((d) => ({ ...(d.data() as PassDoc), id: d.id })) }),
      () => setState((s) => ({ key, ...(s.data ? { data: s.data } : {}), error: true })),
    )
  }, [tenantId, uid, key])

  const current = state.key === key
  const retry = () => setAttempt((n) => n + 1)
  if (current && state.error) return { isPending: false, isError: true, data: state.data, retry }
  if (current && state.data) return { isPending: false, isError: false, data: state.data, retry }
  return { isPending: true, isError: false, data: undefined, retry }
}

/** The tenant's rejection reasons, or the defaults when it has not set its own (or could not be read). */
export function useRejectionReasons(tenantId: string): readonly RejectionReasonDef[] {
  const tenant = useTenant(tenantId)
  const own = tenant.data?.rejectionReasons
  return own && own.length > 0 ? own : DEFAULT_REJECTION_REASONS
}
