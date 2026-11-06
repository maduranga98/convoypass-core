import { skipToken, useQuery, useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import { onSnapshot, type DocumentReference, type DocumentSnapshot, type Query, type QuerySnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Starts a listener; `next` gets every new value (the first one is the initial load), `fail` a listener error. Returns the unsubscribe. */
export type Subscribe<T> = (next: (value: T) => void, fail: (error: unknown) => void) => () => void

/** A live collection query: every change on the server arrives here by itself. */
export const liveQuery =
  <T>(q: Query, map: (snap: QuerySnapshot) => T): Subscribe<T> =>
  (next, fail) =>
    onSnapshot(q, (snap) => next(map(snap)), fail)

/** A live single document. */
export const liveDoc =
  <T>(ref: DocumentReference, map: (snap: DocumentSnapshot) => T): Subscribe<T> =>
  (next, fail) =>
    onSnapshot(ref, (snap) => next(map(snap)), fail)

/**
 * Firestore data that updates by itself, with the shape of a TanStack query (`data`, `isPending`, `isError`, `error`,
 * `refetch`). One listener per mounted screen, started when `enabled` and `queryKey` allow it and stopped when the screen
 * goes away; the latest value stays in the query cache, so coming back shows it at once while the listener catches up.
 * Writes elsewhere (a supervisor edits a vehicle, a guard checks one in) show up without a reload.
 */
export function useLiveQuery<T>(queryKey: QueryKey, subscribe: Subscribe<T>, enabled = true): UseQueryResult<T, Error> {
  const queryClient = useQueryClient()
  const key = JSON.stringify(queryKey)
  const latest = useRef(subscribe)
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    latest.current = subscribe
  })

  useEffect(() => {
    if (!enabled) return
    return latest.current(
      (value) => {
        setFailure(null)
        queryClient.setQueryData(queryKey, value)
      },
      (error) => setFailure({ key, error }),
    )
    // `queryKey` is represented by `key`; the subscribe function is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt, queryClient])

  // The data only ever arrives by `setQueryData`; the query itself never fetches.
  const base = useQuery<T, Error>({ queryKey, queryFn: skipToken, staleTime: Infinity, gcTime: 5 * 60_000 })
  const retry = useCallback(() => {
    setFailure(null)
    setAttempt((n) => n + 1)
    return Promise.resolve(base)
  }, [base])

  if (failure?.key === key && base.data === undefined) {
    return { ...base, status: 'error', isError: true, isPending: false, isSuccess: false, error: failure.error as Error, refetch: retry } as UseQueryResult<T, Error>
  }
  return { ...base, refetch: retry } as UseQueryResult<T, Error>
}
