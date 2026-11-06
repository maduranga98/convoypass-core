import { collection, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { db } from '@/lib/firebase'
import type { PassStatus, PassWithId } from '@/types/passes'
import { getQueueState, LOADING, retryQueue, subscribeQueue, type QueueState } from './passQueueStore'

export const QUEUE_LIMIT = 100

export interface PassQueueOptions {
  /** `supervisor` is always locked to the caller's own contractor (claims), whatever else is passed. */
  scope: 'supervisor' | 'officer' | 'admin'
  status?: PassStatus | readonly PassStatus[]
  /** Passes of exactly this day (`YYYYMMDD`). */
  dateKey?: string
  /** Passes of days strictly before this one (the "expired" list). Newest day first. */
  before?: string
  enabled?: boolean
}

export interface PassQueue {
  items: PassWithId[]
  isLoading: boolean
  isError: boolean
  /** The Firestore error behind `isError` (permission, missing index, offline), for `ErrorState`. */
  error: unknown
  /** True when the listener hit the limit, so more passes may exist than are shown. */
  capped: boolean
  retry: () => void
}

const statuses = (s: PassQueueOptions['status']): PassStatus[] => (s === undefined ? [] : typeof s === 'string' ? [s] : [...s])

/**
 * Live (onSnapshot) list of passes, newest first, max 100. Every query carries the `where` clauses the security
 * rules require (tenant, and contractor for supervisors); the listener is shared and unsubscribed on unmount.
 */
export function usePassQueue(opts: PassQueueOptions): PassQueue {
  const { claims } = useSession()
  const { scope, dateKey, before, enabled = true } = opts
  const status = statuses(opts.status)
  const contractorId = scope === 'supervisor' ? claims.contractorId : null
  const ready = enabled && (scope !== 'supervisor' || contractorId !== null)
  const key = [scope, claims.tenantId, contractorId ?? '', status.join(','), dateKey ?? '', before ?? ''].join('|')

  const build = useCallback(() => {
    const c: QueryConstraint[] = [where('tenantId', '==', claims.tenantId)]
    if (contractorId) c.push(where('contractorId', '==', contractorId))
    if (status.length === 1) c.push(where('status', '==', status[0] as PassStatus))
    else if (status.length > 1) c.push(where('status', 'in', status))
    if (dateKey) c.push(where('dateKey', '==', dateKey))
    if (before) c.push(where('dateKey', '<', before), orderBy('dateKey', 'desc'))
    c.push(orderBy('submittedAt', 'desc'), limit(QUEUE_LIMIT))
    return query(collection(db, 'passes'), ...c)
    // `status` is rebuilt every render; its content is in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, claims.tenantId, contractorId, dateKey, before])

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
      capped: state.items.length >= QUEUE_LIMIT,
      retry,
    }),
    [state, retry],
  )
}
