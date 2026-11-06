import { useCallback, useRef, useState } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { checkIn, checkInVisit, checkOutVisit, denyEntry, logUnloadingCheck } from '@/lib/api'
import type { GateDef } from '@/lib/gates'
import { newRequestId } from '@/lib/requestId'
import { strings } from '@/lib/strings'
import { enqueueGate } from './gateQueue'
import { errorReason, gateErrorMessage, isRetryable } from './gateErrors'
import type { CheckInVisitResult } from '@/types/visits'
import type { NewQueueItem } from './offlineQueue'

export type ActionOutcome<T = undefined> =
  | { kind: 'online'; atMs: number; data?: T }
  /** Saved in the offline queue; `atMs` is the device time (unverified). */
  | { kind: 'offline'; atMs: number }
  | { kind: 'error'; message: string; reason: string | null }
  /** A second tap while the first is still running. */
  | { kind: 'ignored' }

async function saveOffline<T = undefined>(uid: string, item: NewQueueItem, atMs: number): Promise<ActionOutcome<T>> {
  try {
    const r = await enqueueGate(uid, item)
    return r.ok ? { kind: 'offline', atMs } : { kind: 'error', message: strings.gate.queueFull, reason: 'queue-full' }
  } catch {
    return { kind: 'error', message: strings.common.somethingWrong, reason: null }
  }
}

/**
 * Runs one gate action at a time. A new requestId is made per tap; offline (or a network failure) puts the request in
 * the queue with that same id, so a call that did reach the server is replayed safely. A second tap while one is in
 * flight is ignored (guarded by a ref, so even two taps in the same frame fire one request).
 */
function useGateAction() {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const run = useCallback(async <T = undefined>(online: () => Promise<{ atMs: number; data?: T }>, offline: (requestId: string, capturedAt: string) => Promise<ActionOutcome<T>>, requestId: string): Promise<ActionOutcome<T>> => {
    if (busy.current) return { kind: 'ignored' } as const
    busy.current = true
    setPending(true)
    const capturedAt = new Date()
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return await offline(requestId, capturedAt.toISOString())
      return { kind: 'online', ...(await online()) } as const
    } catch (e) {
      if (isRetryable(e)) return await offline(requestId, capturedAt.toISOString())
      return { kind: 'error', message: gateErrorMessage(e), reason: errorReason(e) } as const
    } finally {
      busy.current = false
      setPending(false)
    }
  }, [])
  return { run, pending, busy }
}

export interface CheckInTarget {
  passId: string
  attempt: number
  plateNo: string
  vehicleId: string
}

export function useCheckIn() {
  const { uid } = useSession()
  const { run, pending, busy } = useGateAction()
  const go = useCallback(
    (target: CheckInTarget, gate: GateDef): Promise<ActionOutcome> => {
      if (busy.current) return Promise.resolve({ kind: 'ignored' })
      const requestId = newRequestId()
      const payload = { passId: target.passId, expectedAttempt: target.attempt, gateId: gate.id, requestId }
      return run(
        async () => ({ atMs: (await checkIn(payload)).at }),
        (id, capturedAt) =>
          saveOffline(
            uid,
            {
              type: 'checkIn', requestId: id, payload: { ...payload, offlineCapturedAt: capturedAt }, capturedAtISO: capturedAt,
              plateNo: target.plateNo, vehicleId: target.vehicleId, createdAt: Date.now(),
            },
            Date.parse(capturedAt),
          ),
        requestId,
      )
    },
    [uid, run, busy],
  )
  return { checkIn: go, pending }
}

export function useDenyEntry() {
  const { uid } = useSession()
  const { run, pending, busy } = useGateAction()
  const go = useCallback(
    (target: { vehicleId: string; plateNo: string }, gate: GateDef, choice: { reasonCode: string; note?: string }): Promise<ActionOutcome> => {
      if (busy.current) return Promise.resolve({ kind: 'ignored' })
      const requestId = newRequestId()
      const payload = { vehicleId: target.vehicleId, reasonCode: choice.reasonCode, ...(choice.note ? { note: choice.note } : {}), gateId: gate.id, requestId }
      return run(
        async () => ({ atMs: (await denyEntry(payload)).at }),
        (id, capturedAt) =>
          saveOffline(
            uid,
            { type: 'deny', requestId: id, payload, capturedAtISO: capturedAt, plateNo: target.plateNo, vehicleId: target.vehicleId, createdAt: Date.now() },
            Date.parse(capturedAt),
          ),
        requestId,
      )
    },
    [uid, run, busy],
  )
  return { deny: go, pending }
}

export interface VehicleRef {
  vehicleId: string
  plateNo: string
}

/**
 * Repeat entry of a vehicle that already had its first check-in. The caller owns `ids` (one pair per intent), so a retried
 * tap, an online retry and the queued copy are all the same request.
 */
export function useCheckInVisit() {
  const { uid } = useSession()
  const { run, pending, busy } = useGateAction()
  const go = useCallback(
    (target: VehicleRef, gateId: string | undefined, ids: { visitId: string; requestId: string }): Promise<ActionOutcome<CheckInVisitResult>> => {
      if (busy.current) return Promise.resolve({ kind: 'ignored' })
      const payload = { visitId: ids.visitId, vehicleId: target.vehicleId, ...(gateId ? { gateId } : {}), requestId: ids.requestId }
      return run<CheckInVisitResult>(
        async () => {
          const data = await checkInVisit(payload)
          return { atMs: data.outcome === 'checked_in' ? data.at : Date.now(), data }
        },
        (id, capturedAt) =>
          saveOffline<CheckInVisitResult>(
            uid,
            { type: 'checkInVisit', requestId: id, payload, capturedAtISO: capturedAt, plateNo: target.plateNo, vehicleId: target.vehicleId, createdAt: Date.now() },
            Date.parse(capturedAt),
          ),
        ids.requestId,
      )
    },
    [uid, run, busy],
  )
  return { checkInAgain: go, pending }
}

export function useCheckOutVisit() {
  const { uid } = useSession()
  const { run, pending, busy } = useGateAction()
  const go = useCallback(
    (target: VehicleRef, visitId: string, requestId: string): Promise<ActionOutcome> => {
      if (busy.current) return Promise.resolve({ kind: 'ignored' })
      const payload = { visitId, requestId }
      return run(
        async () => ({ atMs: (await checkOutVisit(payload)).at }),
        (id, capturedAt) =>
          saveOffline(
            uid,
            { type: 'checkOutVisit', requestId: id, payload, capturedAtISO: capturedAt, plateNo: target.plateNo, vehicleId: target.vehicleId, createdAt: Date.now() },
            Date.parse(capturedAt),
          ),
        requestId,
      )
    },
    [uid, run, busy],
  )
  return { checkOut: go, pending }
}

/**
 * Yard Officer's unloading answer. The server overwrites `unloadingCheck` (last write wins), so there is no idempotency
 * key: the requestId only identifies the queue item, and a newer answer for the same visit replaces a waiting one.
 */
export function useLogUnloading() {
  const { uid } = useSession()
  const { run, pending, busy } = useGateAction()
  const go = useCallback(
    (target: VehicleRef, visitId: string, answer: { unloaded: boolean; unloadLocation?: string }): Promise<ActionOutcome> => {
      if (busy.current) return Promise.resolve({ kind: 'ignored' })
      const payload = { visitId, unloaded: answer.unloaded, ...(answer.unloaded && answer.unloadLocation ? { unloadLocation: answer.unloadLocation } : {}) }
      return run(
        async () => ({ atMs: (await logUnloadingCheck(payload)).at }),
        (id, capturedAt) =>
          saveOffline(
            uid,
            { type: 'logUnloading', requestId: id, payload, capturedAtISO: capturedAt, plateNo: target.plateNo, vehicleId: target.vehicleId, createdAt: Date.now() },
            Date.parse(capturedAt),
          ),
        newRequestId(),
      )
    },
    [uid, run, busy],
  )
  return { logUnloading: go, pending }
}
