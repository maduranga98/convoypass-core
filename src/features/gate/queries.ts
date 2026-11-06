import { useQueries, useQuery } from '@tanstack/react-query'
import { FirebaseError } from 'firebase/app'
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { db } from '@/lib/firebase'
import type { Contractor, Driver, Vehicle, WithId } from '@/types'
import type { PassDoc, PassStatus, PassWithId } from '@/types/passes'

// Security reads straight from Firestore under the existing rules; every query carries the tenant from the token.
// Single documents go through TanStack Query with a long cache, so a vehicle, driver or contractor that was seen
// once this session still shows when the connection drops.

export const GATE_LIST_LIMIT = 300
const KEEP = { staleTime: 5 * 60_000, gcTime: 12 * 60 * 60_000, retry: false, networkMode: 'offlineFirst' } as const

/** `permission-denied` and a missing document both mean "not here": never reveal that it exists in another tenant. */
const denied = (e: unknown): boolean => e instanceof FirebaseError && e.code === 'permission-denied'

async function readDoc<T>(path: string, id: string): Promise<WithId<T> | null> {
  try {
    const snap = await getDoc(doc(db, path, id))
    return snap.exists() ? { ...(snap.data() as T), id: snap.id } : null
  } catch (e) {
    if (denied(e)) return null
    throw e
  }
}

export function useVehicleDoc(vehicleId: string | null, initial?: WithId<Vehicle>) {
  return useQuery({
    queryKey: ['vehicleDoc', vehicleId],
    enabled: vehicleId !== null,
    queryFn: () => readDoc<Vehicle>('vehicles', vehicleId as string),
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
    ...KEEP,
  })
}

export function useDriverDoc(driverId: string | null) {
  return useQuery({
    queryKey: ['driverDoc', driverId],
    enabled: driverId !== null,
    queryFn: () => readDoc<Driver>('drivers', driverId as string),
    ...KEEP,
  })
}

export function useContractorDoc(contractorId: string | null) {
  return useQuery({
    queryKey: ['contractorDoc', contractorId],
    enabled: contractorId !== null,
    queryFn: () => readDoc<Contractor>('contractors', contractorId as string),
    ...KEEP,
  })
}

/**
 * Prefetch for offline use: the driver and contractor of every pass on today's gate lists, so opening any of them
 * works without a connection.
 */
export function usePrefetchPassPeople(passes: readonly PassWithId[]): void {
  const driverIds = useMemo(() => [...new Set(passes.map((p) => p.driverId))], [passes])
  const contractorIds = useMemo(() => [...new Set(passes.map((p) => p.contractorId))], [passes])
  useQueries({
    queries: driverIds.map((id) => ({ queryKey: ['driverDoc', id], queryFn: () => readDoc<Driver>('drivers', id), ...KEEP })),
  })
  useQueries({
    queries: contractorIds.map((id) => ({ queryKey: ['contractorDoc', id], queryFn: () => readDoc<Contractor>('contractors', id), ...KEEP })),
  })
}

export interface GatePasses {
  items: PassWithId[]
  status: 'loading' | 'ready' | 'error'
  /** The last snapshot came from the local cache, not the server. */
  fromCache: boolean
  /** Device time of the last snapshot that came from the server. */
  lastSyncedAt: number | null
  /** Since when snapshots have only come from the cache (null when the last one was from the server). */
  cacheSince: number | null
  capped: boolean
  retry: () => void
}

const GATE_STATUSES: PassStatus[] = ['officer_approved', 'checked_in']

/**
 * Today's approved and checked-in passes of the tenant, live (limit 300), with snapshot metadata so the screen can
 * say "Last synced HH:mm" and warn when it has only seen cached data for a while.
 */
export function useTodayGatePasses(today: string | null): GatePasses {
  const { claims } = useSession()
  const [attempt, setAttempt] = useState(0)
  const key = `${claims.tenantId}|${today ?? ''}|${attempt}`
  const [state, setState] = useState<Omit<GatePasses, 'retry' | 'capped'> & { key: string }>({
    key: '', items: [], status: 'loading', fromCache: false, lastSyncedAt: null, cacheSince: null,
  })

  useEffect(() => {
    if (!today) return
    return onSnapshot(
      query(
        collection(db, 'passes'),
        where('tenantId', '==', claims.tenantId),
        where('dateKey', '==', today),
        where('status', 'in', GATE_STATUSES),
        limit(GATE_LIST_LIMIT),
      ),
      { includeMetadataChanges: true },
      (snap) => {
        const fromCache = snap.metadata.fromCache
        const now = Date.now()
        setState((s) => ({
          key,
          items: snap.docs.map((d) => ({ ...(d.data() as PassDoc), id: d.id })),
          status: 'ready',
          fromCache,
          lastSyncedAt: fromCache ? (s.key === key ? s.lastSyncedAt : null) : now,
          cacheSince: fromCache ? (s.key === key && s.cacheSince !== null ? s.cacheSince : now) : null,
        }))
      },
      () => setState((s) => ({ ...s, key, status: 'error' })),
    )
  }, [claims.tenantId, today, key])

  const current = state.key === key
  return {
    items: current ? state.items : [],
    status: current ? state.status : 'loading',
    fromCache: current ? state.fromCache : false,
    lastSyncedAt: current ? state.lastSyncedAt : null,
    cacheSince: current ? state.cacheSince : null,
    capped: current && state.items.length >= GATE_LIST_LIMIT,
    retry: () => setAttempt((n) => n + 1),
  }
}

/**
 * Server-side plate search for fleets larger than the cached list: a prefix range on `plateKey` (the
 * tenantId + plateKey index). Prefix only: Firestore cannot do "contains".
 */
export function usePlatePrefixSearch(key: string, enabled: boolean) {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['platePrefix', claims.tenantId, key],
    enabled: enabled && key.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<WithId<Vehicle>[]> => {
      const snap = await getDocs(
        query(
          collection(db, 'vehicles'),
          where('tenantId', '==', claims.tenantId),
          where('plateKey', '>=', key),
          where('plateKey', '<', `${key}`),
          orderBy('plateKey'),
          limit(8),
        ),
      )
      return snap.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id }))
    },
  })
}
