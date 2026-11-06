import { createStore, get, update, type UseStore } from 'idb-keyval'
import type { CheckInPayload, DenyEntryPayload } from '@/types/passes'
import type { CheckInVisitPayload, CheckOutVisitPayload, UnloadingCheckPayload } from '@/types/visits'

/** More than this is refused with a clear message: the guard must get back online first. */
export const MAX_QUEUE = 50

interface ItemBase {
  /** Also the idempotency key the server sees, so a retry can never act twice. */
  requestId: string
  /** Device time of the action (ISO), shown as unverified. */
  capturedAtISO: string
  /** Only ids and the plate: no names, photos or other personal data are stored on the phone. */
  plateNo: string
  vehicleId: string
  /** Milliseconds, device clock; orders the queue (oldest first). */
  createdAt: number
  /** `failed` items were refused by the server and stay until the guard dismisses them. */
  status: 'waiting' | 'failed'
  error?: string
}

export type QueueItem = ItemBase &
  (
    | { type: 'checkIn'; payload: CheckInPayload }
    | { type: 'deny'; payload: DenyEntryPayload }
    /** Repeat entry of a vehicle (Security). `payload.requestId` equals `requestId`. */
    | { type: 'checkInVisit'; payload: CheckInVisitPayload }
    | { type: 'checkOutVisit'; payload: CheckOutVisitPayload }
    /** Yard Officer's unloading answer. Last write wins on the server, so `requestId` is only the queue's own key. */
    | { type: 'logUnloading'; payload: UnloadingCheckPayload }
  )
export type NewQueueItem = QueueItem extends infer T ? (T extends QueueItem ? Omit<T, 'status' | 'error'> : never) : never

export type EnqueueResult = { ok: true; item: QueueItem; duplicate: boolean } | { ok: false; reason: 'full' }

const byAge = (a: QueueItem, b: QueueItem) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId)

/** The IndexedDB store. Opened on first use (opening it touches IndexedDB). */
export const openGateStore = (): UseStore => createStore('convoypass-gate', 'queue')

/**
 * The offline queue of one guard's account (`key`), persisted in IndexedDB so it survives a reload or a crash.
 * Every change runs in one IndexedDB transaction (`update`), so two tabs cannot lose each other's items.
 */
export class OfflineQueue {
  readonly key: string
  private readonly store: UseStore

  constructor(key: string, store: UseStore) {
    this.key = key
    this.store = store
  }

  async list(): Promise<QueueItem[]> {
    return [...((await get<QueueItem[]>(this.key, this.store)) ?? [])].sort(byAge)
  }

  /**
   * Adds an item, unless it is already there: the same requestId, a waiting check-in for the same pass, a waiting repeat
   * entry for the same vehicle or a waiting check-out for the same visit (the same vehicle can never be queued in twice).
   * A waiting unloading answer for the same visit is replaced by the newer one (keeps its place in line). A full queue
   * refuses new items.
   */
  async enqueue(input: NewQueueItem): Promise<EnqueueResult> {
    let result: EnqueueResult = { ok: false, reason: 'full' }
    await update<QueueItem[]>(
      this.key,
      (current = []) => {
        const same = current.find(
          (i) =>
            i.requestId === input.requestId ||
            (input.type === 'checkIn' && i.type === 'checkIn' && i.status === 'waiting' && i.payload.passId === input.payload.passId) ||
            (input.type === 'checkInVisit' && i.type === 'checkInVisit' && i.status === 'waiting' && i.payload.vehicleId === input.payload.vehicleId) ||
            (input.type === 'checkOutVisit' && i.type === 'checkOutVisit' && i.status === 'waiting' && i.payload.visitId === input.payload.visitId),
        )
        if (same) {
          result = { ok: true, item: same, duplicate: true }
          return current
        }
        if (input.type === 'logUnloading') {
          const older = current.find((i) => i.type === 'logUnloading' && i.status === 'waiting' && i.payload.visitId === input.payload.visitId)
          if (older) {
            const item = { ...input, status: 'waiting', createdAt: older.createdAt } as QueueItem
            result = { ok: true, item, duplicate: false }
            return current.map((i) => (i === older ? item : i))
          }
        }
        if (current.length >= MAX_QUEUE) {
          result = { ok: false, reason: 'full' }
          return current
        }
        const item = { ...input, status: 'waiting' } as QueueItem
        result = { ok: true, item, duplicate: false }
        return [...current, item]
      },
      this.store,
    )
    return result
  }

  async remove(requestId: string): Promise<void> {
    await update<QueueItem[]>(this.key, (current = []) => current.filter((i) => i.requestId !== requestId), this.store)
  }

  async markFailed(requestId: string, error: string): Promise<void> {
    await update<QueueItem[]>(
      this.key,
      (current = []) => current.map((i) => (i.requestId === requestId ? { ...i, status: 'failed' as const, error } : i)),
      this.store,
    )
  }
}

export type Classified = { retry: true } | { retry: false; message: string }

export interface FlushResult {
  sent: number
  failed: number
  /** True when a retryable error (network, unavailable) stopped the run; the rest waits for the next one. */
  stopped: boolean
}

/**
 * Sends waiting items oldest first, one at a time. Success removes the item. A retryable error stops the run and
 * keeps the item (and the order); any other server error is final: the item is marked `failed` with a readable
 * message and kept until the guard dismisses it. Idempotency (requestId) makes every retry safe.
 */
export async function flushQueue(
  queue: OfflineQueue,
  send: (item: QueueItem) => Promise<unknown>,
  classify: (e: unknown) => Classified,
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, stopped: false }
  for (const item of (await queue.list()).filter((i) => i.status === 'waiting')) {
    try {
      await send(item)
      await queue.remove(item.requestId)
      result.sent++
    } catch (e) {
      const c = classify(e)
      if (c.retry) {
        result.stopped = true
        break
      }
      await queue.markFailed(item.requestId, c.message)
      result.failed++
    }
  }
  return result
}
