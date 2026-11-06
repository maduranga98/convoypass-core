import { useQuery } from '@tanstack/react-query'
import { collection, limit, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { dayRange } from '@/features/admin/gateLog'
import { getQueueState, LOADING, retryQueue, subscribeQueue, type QueueState } from '@/features/passes/passQueueStore'
import { useTenant } from '@/features/passes/queries'
import { useToday } from '@/features/passes/useToday'
import { getDashboardTrend } from '@/lib/api'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { db } from '@/lib/firebase'
import type { GateEventDoc, PassWithId } from '@/types/passes'

/** Today's passes are read live, up to this many. Over it the dashboard says so instead of guessing. */
export const TODAY_CAP = 1000
const EVENT_CAP = 200

export interface TodayPasses {
  items: PassWithId[]
  isLoading: boolean
  isError: boolean
  error: unknown
  capped: boolean
  updatedAt: number | null
  retry: () => void
}

/**
 * Every pass of today (tenant timezone), live. One shared `onSnapshot` listener (the Module 4 store) that is
 * unsubscribed when the last component using it unmounts.
 */
export function useTodayPasses(): TodayPasses {
  const { claims } = useSession()
  const today = useToday()
  const ready = today !== null
  const key = ['dashboard', claims.tenantId, today ?? ''].join('|')

  const build = useCallback(
    () =>
      query(
        collection(db, 'passes'),
        where('tenantId', '==', claims.tenantId),
        where('dateKey', '==', today ?? ''),
        orderBy('submittedAt', 'desc'),
        limit(TODAY_CAP),
      ),
    [claims.tenantId, today],
  )
  const subscribe = useCallback(
    (onChange: () => void) => (ready ? subscribeQueue(key, build, onChange) : () => undefined),
    [key, build, ready],
  )
  const getSnapshot = useCallback((): QueueState => (ready ? getQueueState(key) : LOADING), [key, ready])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const retry = useCallback(() => retryQueue(key), [key])

  return useMemo(
    () => ({
      items: state.items,
      isLoading: state.status === 'loading',
      isError: state.status === 'error',
      error: state.error,
      capped: state.items.length >= TODAY_CAP,
      updatedAt: state.updatedAt,
      retry,
    }),
    [state, retry],
  )
}

export interface TodayEvents {
  items: (GateEventDoc & { id: string })[]
  isLoading: boolean
  isError: boolean
  capped: boolean
}

/** Today's denied entries, live, newest first. Unsubscribes on unmount. */
export function useTodayGateEvents(): TodayEvents {
  const { claims } = useSession()
  const today = useToday()
  const tenant = useTenant(claims.tenantId)
  const timezone = tenant.data?.timezone ?? DEFAULT_TIMEZONE
  const [state, setState] = useState<{ key: string; items: (GateEventDoc & { id: string })[]; error: boolean }>({ key: '', items: [], error: false })
  const key = `${claims.tenantId}|${today ?? ''}|${timezone}`

  useEffect(() => {
    if (!today) return undefined
    const { start, end } = dayRange(timezone, today)
    return onSnapshot(
      query(
        collection(db, 'gateEvents'),
        where('tenantId', '==', claims.tenantId),
        where('at', '>=', Timestamp.fromMillis(start)),
        where('at', '<', Timestamp.fromMillis(end)),
        orderBy('at', 'desc'),
        limit(EVENT_CAP),
      ),
      (snap) => setState({ key, items: snap.docs.map((d) => ({ ...(d.data() as GateEventDoc), id: d.id })), error: false }),
      () => setState((s) => ({ ...s, key, error: true })),
    )
  }, [claims.tenantId, today, timezone, key])

  const fresh = state.key === key
  return {
    items: fresh ? state.items : [],
    isLoading: !fresh,
    isError: fresh && state.error,
    capped: fresh && state.items.length >= EVENT_CAP,
  }
}

/** `getDashboardTrend`: `count()` aggregations on the server, cached for 5 minutes, refreshed by hand. */
export function useTrend(days: 7 | 14 | 30) {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['dashboardTrend', claims.tenantId, days],
    staleTime: 5 * 60_000,
    queryFn: () => getDashboardTrend({ days }),
  })
}

