import { useQuery } from '@tanstack/react-query'
import { collection, doc, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { liveDoc, liveQuery, useLiveQuery } from '@/lib/liveQuery'
import { downloadUrl } from '@/lib/storage'
import type { Contractor, Driver, UserDoc, Vehicle, WithId } from '@/types'
import { useScope, type Scope } from './scope'

/** Lists load once per scope, capped; search and filters run client-side. */
export const LIST_CAP = 1000

export interface ListData<T> {
  items: WithId<T>[]
  /** True when the cap was hit, so more records may exist than are shown. */
  capped: boolean
}

function scoped(tenantId: string, contractorId: string | null, order: string): QueryConstraint[] {
  return [
    where('tenantId', '==', tenantId),
    ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
    orderBy(order),
    limit(LIST_CAP),
  ]
}

/** The live list of a collection: capped, with the cap flag. */
const live = <T>(name: string, constraints: QueryConstraint[]) =>
  liveQuery(query(collection(db, name), ...constraints), (snap): ListData<T> => ({
    items: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })),
    capped: snap.size >= LIST_CAP,
  }))

export function useVehicles(scope: Scope, opts: { enabled?: boolean } = {}) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(['vehicles', tenantId, contractorId ?? 'all'], live<Vehicle>('vehicles', scoped(tenantId, contractorId, 'plateKey')), ready && (opts.enabled ?? true))
}

export function useDrivers(scope: Scope, opts: { enabled?: boolean } = {}) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(['drivers', tenantId, contractorId ?? 'all'], live<Driver>('drivers', scoped(tenantId, contractorId, 'name')), ready && (opts.enabled ?? true))
}

/**
 * The drivers' `users` docs, for "Last signed in" and the device count (Module 12). Equality filters only (no composite
 * index); a supervisor's query carries `role == driver` and their contractor, exactly what the rules require.
 */
export function useDriverAccounts(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(
    ['users', tenantId, 'driver', contractorId ?? 'all'],
    liveQuery(
      query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        where('role', '==', 'driver'),
        ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
        limit(LIST_CAP),
      ),
      (snap): Map<string, UserDoc> => new Map(snap.docs.map((d) => [d.id, d.data() as UserDoc])),
    ),
    ready,
  )
}

/**
 * Admin: every contractor of the tenant. Supervisor: just their own (rules only allow reading that document,
 * so a tenant-wide query would be denied).
 */
export function useContractorList(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(
    ['contractors', tenantId, contractorId ?? 'all'],
    contractorId
      ? liveDoc(doc(db, 'contractors', contractorId), (snap): WithId<Contractor>[] => (snap.exists() ? [{ ...(snap.data() as Contractor), id: snap.id }] : []))
      : liveQuery(
          query(collection(db, 'contractors'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc')),
          (snap): WithId<Contractor>[] => snap.docs.map((d) => ({ ...(d.data() as Contractor), id: d.id })),
        ),
    ready,
  )
}

/** Photo URLs are fetched on demand from the stored path and cached. `version` busts the cache after a re-upload. */
export function useDriverPhotoUrl(photoPath: string | null | undefined, version?: number) {
  return useQuery({
    queryKey: ['driverPhotoUrl', photoPath, version ?? 0],
    enabled: Boolean(photoPath),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    queryFn: () => downloadUrl(photoPath as string),
  })
}
