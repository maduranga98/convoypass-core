import { collection, limit as limitTo, onSnapshot, orderBy, query, where, type FirestoreError, type QueryConstraint } from 'firebase/firestore'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { useNow } from '@/features/passes/useToday'
import { db } from '@/lib/firebase'
import type { Penalty } from '@/types/penalties'
import { blocksNow, byIssuedDesc, type PenaltyRow, type PenaltyScope } from './model'

/**
 * Live (onSnapshot) penalty lists. One Firestore listener per distinct query, shared by everything that asks for it (the
 * nav badge and the page under it) and stopped with the last subscriber. Every query carries the `where` clauses the
 * rules require: the tenant, and for a supervisor their own contractor.
 */
export type FeedKind = 'all' | 'active' | 'awaiting'

export const FEED_LIMIT = 500
export const HISTORY_LIMIT = 200

interface State {
  status: 'loading' | 'ready' | 'error'
  items: PenaltyRow[]
  error: FirestoreError | null
}
const LOADING: State = { status: 'loading', items: [], error: null }

interface Entry {
  state: State
  listeners: Set<() => void>
  start: () => void
  stop: (() => void) | null
}
const entries = new Map<string, Entry>()

function subscribeFeed(key: string, constraints: QueryConstraint[], onChange: () => void): () => void {
  let entry = entries.get(key)
  if (!entry) {
    const created: Entry = {
      state: LOADING,
      listeners: new Set(),
      stop: null,
      start: () => {
        created.stop?.()
        created.state = LOADING
        created.stop = onSnapshot(
          query(collection(db, 'penalties'), ...constraints),
          (snap) => {
            created.state = { status: 'ready', items: snap.docs.map((d) => ({ ...(d.data() as Penalty), id: d.id })), error: null }
            created.listeners.forEach((l) => l())
          },
          (error) => {
            created.state = { status: 'error', items: created.state.items, error }
            created.listeners.forEach((l) => l())
          },
        )
      },
    }
    entry = created
    entries.set(key, entry)
    entry.start()
  }
  entry.listeners.add(onChange)
  return () => {
    const e = entries.get(key)
    if (!e) return
    e.listeners.delete(onChange)
    if (e.listeners.size === 0) {
      e.stop?.()
      entries.delete(key)
    }
  }
}

export interface PenaltyFeedOptions {
  scope: PenaltyScope
  kind?: FeedKind
  /** History of one vehicle or driver (a penalty on both appears for each). */
  vehicleId?: string
  driverId?: string
  enabled?: boolean
}

export interface PenaltyFeed {
  items: PenaltyRow[]
  isLoading: boolean
  isError: boolean
  error: unknown
  capped: boolean
  retry: () => void
}

export function usePenaltyFeed({ scope, kind = 'all', vehicleId, driverId, enabled = true }: PenaltyFeedOptions): PenaltyFeed {
  const { claims } = useSession()
  const contractorId = scope === 'supervisor' ? claims.contractorId : null
  const ready = enabled && (scope !== 'supervisor' || contractorId !== null)
  const key = [claims.tenantId, contractorId ?? '', kind, vehicleId ?? '', driverId ?? ''].join('|')
  const isHistory = vehicleId !== undefined || driverId !== undefined
  const cap = isHistory ? HISTORY_LIMIT : FEED_LIMIT

  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [where('tenantId', '==', claims.tenantId)]
    if (contractorId) c.push(where('contractorId', '==', contractorId))
    if (vehicleId) c.push(where('target.vehicleId', '==', vehicleId))
    if (driverId) c.push(where('target.driverId', '==', driverId))
    if (kind === 'active') c.push(where('status', '==', 'active'))
    if (kind === 'awaiting') c.push(where('verification.verifiedBy', '==', null))
    // Equality-only queries need no composite index; only the plain company/contractor list is ordered by the server.
    if (kind === 'all' && !isHistory) c.push(orderBy('issuedAt', 'desc'))
    c.push(limitTo(cap))
    return c
    // `key` captures every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const subscribe = useCallback((onChange: () => void) => (ready ? subscribeFeed(key, constraints, onChange) : () => undefined), [ready, key, constraints])
  const state = useSyncExternalStore(subscribe, () => (ready ? (entries.get(key)?.state ?? LOADING) : LOADING))
  const retry = useCallback(() => entries.get(key)?.start(), [key])

  const items = useMemo(() => (isHistory || kind !== 'all' ? [...state.items].sort(byIssuedDesc) : state.items), [state.items, isHistory, kind])
  return { items, isLoading: ready && state.status === 'loading', isError: state.status === 'error', error: state.error, capped: state.items.length >= cap, retry }
}

export interface BlockedSets {
  isLoading: boolean
  isError: boolean
  /** Vehicle id -> the penalties that block it right now. */
  vehicles: Map<string, PenaltyRow[]>
  drivers: Map<string, PenaltyRow[]>
}

/**
 * Which vehicles and drivers are blocked at this moment, live. An end date that passes flips a record to unblocked on the
 * next 30 s tick without waiting for the scheduled job (the same rule as the server, `isBlocking`).
 */
export function useBlocked(scope: PenaltyScope, enabled = true): BlockedSets {
  const feed = usePenaltyFeed({ scope, kind: 'active', enabled })
  const now = useNow()
  return useMemo(() => {
    const vehicles = new Map<string, PenaltyRow[]>()
    const drivers = new Map<string, PenaltyRow[]>()
    for (const p of feed.items) {
      if (!blocksNow(p, now)) continue
      for (const [id, map] of [[p.target.vehicleId, vehicles], [p.target.driverId, drivers]] as const) {
        if (id) map.set(id, [...(map.get(id) ?? []), p])
      }
    }
    return { isLoading: feed.isLoading, isError: feed.isError, vehicles, drivers }
  }, [feed.items, feed.isLoading, feed.isError, now])
}

/** Penalties waiting for this supervisor's review, live (the nav badge and the queue share one listener). */
export function useAwaitingReview(enabled = true) {
  const feed = usePenaltyFeed({ scope: 'supervisor', kind: 'awaiting', enabled })
  const waiting = useMemo(() => feed.items.filter((p) => p.status !== 'revoked'), [feed.items])
  return { ...feed, waiting }
}
