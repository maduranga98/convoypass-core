import { useEffect, useSyncExternalStore } from 'react'
import { gatePassDenial } from '@/features/visits/gatePassDenial'
import { deniedReasons } from '@/features/visits/reasons'
import { checkIn, checkInVisit, checkOutVisit, denyEntry, logUnloadingCheck } from '@/lib/api'
import { strings } from '@/lib/strings'
import { classifyGateError } from './gateErrors'
import { flushQueue, OfflineQueue, openGateStore, type EnqueueResult, type NewQueueItem, type QueueItem } from './offlineQueue'

// The guard's offline queue as a React store. One queue per account (`queue:{uid}`), so items always sync under
// the identity that made them; a different guard signing in on the phone neither sees nor sends them.

const SYNC_EVERY_MS = 30_000
const EMPTY: QueueItem[] = []

let store: ReturnType<typeof openGateStore> | null = null
const queues = new Map<string, OfflineQueue>()
const items = new Map<string, QueueItem[]>()
const listeners = new Set<() => void>()
const running = new Map<string, Promise<void>>()
const syncing = new Set<string>()

export function queueFor(uid: string): OfflineQueue {
  let q = queues.get(uid)
  if (!q) {
    store ??= openGateStore()
    q = new OfflineQueue(`queue:${uid}`, store)
    queues.set(uid, q)
  }
  return q
}

const emit = () => listeners.forEach((l) => l())

export async function refreshQueue(uid: string): Promise<void> {
  try {
    items.set(uid, await queueFor(uid).list())
  } catch {
    items.set(uid, items.get(uid) ?? EMPTY) // IndexedDB unavailable: show what we had
  }
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Every queued item of this guard, oldest first. Loads from IndexedDB on first use. */
export function useOfflineQueue(uid: string): QueueItem[] {
  useEffect(() => {
    if (!items.has(uid)) void refreshQueue(uid)
  }, [uid])
  return useSyncExternalStore(subscribe, () => items.get(uid) ?? EMPTY, () => EMPTY)
}

export const useQueueSyncing = (uid: string): boolean =>
  useSyncExternalStore(subscribe, () => syncing.has(uid), () => false)

export async function enqueueGate(uid: string, item: NewQueueItem): Promise<EnqueueResult> {
  const result = await queueFor(uid).enqueue(item)
  await refreshQueue(uid)
  return result
}

export async function dismissQueued(uid: string, requestId: string): Promise<void> {
  await queueFor(uid).remove(requestId)
  await refreshQueue(uid)
}

/** A repeat entry the server answered but refused (eligibility, monthly pass): final, shown to the guard as a rejected item. */
class QueuedRefusal extends Error {}

async function send(item: QueueItem): Promise<unknown> {
  switch (item.type) {
    case 'checkIn':
      return checkIn(item.payload)
    case 'deny':
      return denyEntry(item.payload)
    case 'checkOutVisit':
      return checkOutVisit(item.payload)
    case 'logUnloading':
      return logUnloadingCheck(item.payload)
    case 'checkInVisit': {
      const res = await checkInVisit(item.payload)
      if (res.outcome === 'blocked') throw new QueuedRefusal(`${strings.gateMovements.refused}: ${deniedReasons(res.eligibility, { ignoreInspection: true }).join(', ')}`)
      if (res.outcome === 'no_gate_pass') throw new QueuedRefusal(`${strings.gateMovements.refused}: ${gatePassDenial(res.gatePass)}`)
      return res
    }
  }
}

const classify = (e: unknown) => (e instanceof QueuedRefusal ? { retry: false as const, message: e.message } : classifyGateError(e))

/** Flushes the queue (oldest first, one at a time). Concurrent calls share one run. */
export function syncQueue(uid: string): Promise<void> {
  const current = running.get(uid)
  if (current) return current
  const run = (async () => {
    syncing.add(uid)
    emit()
    try {
      await flushQueue(queueFor(uid), send, classify)
    } catch {
      // IndexedDB trouble: try again on the next trigger
    } finally {
      running.delete(uid)
      syncing.delete(uid)
      await refreshQueue(uid)
    }
  })()
  running.set(uid, run)
  return run
}

/** Syncs on mount (app start), on the `online` event and every 30 s while items are waiting. */
export function useQueueSync(uid: string): void {
  const queued = useOfflineQueue(uid)
  const waiting = queued.some((i) => i.status === 'waiting')
  useEffect(() => {
    void syncQueue(uid)
    const onOnline = () => void syncQueue(uid)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [uid])
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => void syncQueue(uid), SYNC_EVERY_MS)
    return () => clearInterval(id)
  }, [uid, waiting])
}

/** Pass ids with a check-in waiting on this phone ("Pending sync"), so a vehicle is never waved through twice. */
export function pendingPassIds(queued: readonly QueueItem[]): Set<string> {
  return new Set(queued.flatMap((i) => (i.type === 'checkIn' && i.status === 'waiting' ? [i.payload.passId] : [])))
}

/** Vehicles with a repeat entry or check-out waiting on this phone, so the movements panel shows "Pending sync". */
export function pendingMovements(queued: readonly QueueItem[], vehicleId: string): QueueItem[] {
  return queued.filter((i) => i.status === 'waiting' && i.vehicleId === vehicleId && (i.type === 'checkInVisit' || i.type === 'checkOutVisit'))
}

/** Visit ids with an unloading answer waiting on this phone. */
export function pendingUnloadingVisitIds(queued: readonly QueueItem[]): Set<string> {
  return new Set(queued.flatMap((i) => (i.type === 'logUnloading' && i.status === 'waiting' ? [i.payload.visitId] : [])))
}
