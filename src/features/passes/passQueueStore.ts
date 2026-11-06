import { onSnapshot, type FirestoreError, type Query } from 'firebase/firestore'
import type { PassDoc, PassWithId } from '@/types/passes'

export interface QueueState {
  status: 'loading' | 'ready' | 'error'
  items: PassWithId[]
  error: FirestoreError | null
  /** When the last snapshot arrived (ms), for "Updated HH:mm". */
  updatedAt: number | null
}

export const LOADING: QueueState = { status: 'loading', items: [], error: null, updatedAt: null }

interface Entry {
  state: QueueState
  listeners: Set<() => void>
  build: () => Query
  stop: (() => void) | null
}

const entries = new Map<string, Entry>()

function start(entry: Entry): void {
  entry.stop?.()
  entry.state = LOADING
  entry.stop = onSnapshot(
    entry.build(),
    (snap) => {
      entry.state = {
        status: 'ready',
        items: snap.docs.map((d) => ({ ...(d.data() as PassDoc), id: d.id })),
        error: null,
        updatedAt: Date.now(),
      }
      entry.listeners.forEach((l) => l())
    },
    (error) => {
      // A failed listener is dead: keep the last items on screen and let the user retry.
      entry.state = { status: 'error', items: entry.state.items, error, updatedAt: entry.state.updatedAt }
      entry.listeners.forEach((l) => l())
    },
  )
}

/**
 * One Firestore listener per distinct query, shared by every component that asks for it (a tab badge and the list
 * under it, for example). The listener starts with the first subscriber and is unsubscribed when the last one leaves.
 */
export function subscribeQueue(key: string, build: () => Query, onChange: () => void): () => void {
  let entry = entries.get(key)
  if (!entry) {
    entry = { state: LOADING, listeners: new Set(), build, stop: null }
    entries.set(key, entry)
    start(entry)
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

export const getQueueState = (key: string): QueueState => entries.get(key)?.state ?? LOADING

/** Restart a listener that errored (for example after a network problem). */
export function retryQueue(key: string): void {
  const e = entries.get(key)
  if (!e) return
  start(e)
  e.listeners.forEach((l) => l())
}

/** Test helper. */
export const activeQueueCount = (): number => entries.size
