import 'fake-indexeddb/auto'
import { FirebaseError } from 'firebase/app'
import { createStore } from 'idb-keyval'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyGateError, gateErrorMessage, isRetryable } from './gateErrors'
import { flushQueue, MAX_QUEUE, OfflineQueue, type NewQueueItem } from './offlineQueue'

let n = 0
let dbName = ''
const store = () => createStore(dbName, 'queue')
const queue = () => new OfflineQueue('queue:sec1', store())

const checkInItem = (i: number, over: Partial<NewQueueItem> = {}): NewQueueItem =>
  ({
    type: 'checkIn',
    requestId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    payload: { passId: `veh_${String(i).padStart(10, '0')}_20260310`, expectedAttempt: 1, gateId: 'main', requestId: `r${i}`, offlineCapturedAt: '2026-03-10T08:00:00.000Z' },
    capturedAtISO: '2026-03-10T08:00:00.000Z',
    plateNo: `CAB-${i}`,
    vehicleId: `veh_${String(i).padStart(10, '0')}`,
    createdAt: 1000 + i,
    ...over,
  }) as NewQueueItem

const typed = (code: string, reason: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new FirebaseError(`functions/${code}`, reason), { details: { reason, ...extra } })
const network = () => new FirebaseError('functions/internal', 'internal')

beforeEach(() => {
  dbName = `convoypass-test-${++n}`
  vi.stubGlobal('navigator', { onLine: true })
})

describe('OfflineQueue', () => {
  it('enqueues and lists oldest first', async () => {
    const q = queue()
    await q.enqueue(checkInItem(3))
    await q.enqueue(checkInItem(1))
    await q.enqueue(checkInItem(2))
    expect((await q.list()).map((i) => i.plateNo)).toEqual(['CAB-1', 'CAB-2', 'CAB-3'])
    expect((await q.list()).every((i) => i.status === 'waiting')).toBe(true)
  })
  it('dedupes: the same requestId, or a second waiting check-in for the same pass', async () => {
    const q = queue()
    expect(await q.enqueue(checkInItem(1))).toMatchObject({ ok: true, duplicate: false })
    expect(await q.enqueue(checkInItem(1))).toMatchObject({ ok: true, duplicate: true })
    const samePass = checkInItem(1, { requestId: 'another-request' } as Partial<NewQueueItem>)
    expect(await q.enqueue(samePass)).toMatchObject({ ok: true, duplicate: true, item: { requestId: checkInItem(1).requestId } })
    expect(await q.list()).toHaveLength(1)
  })
  it('refuses new items beyond 50', async () => {
    const q = queue()
    for (let i = 0; i < MAX_QUEUE; i++) expect(await q.enqueue(checkInItem(i))).toMatchObject({ ok: true })
    expect(await q.enqueue(checkInItem(99))).toEqual({ ok: false, reason: 'full' })
    expect(await q.list()).toHaveLength(MAX_QUEUE)
  })
  it('survives a reload (a new store on the same IndexedDB)', async () => {
    await queue().enqueue(checkInItem(1))
    await queue().enqueue(checkInItem(2))
    const reopened = new OfflineQueue('queue:sec1', createStore(dbName, 'queue'))
    expect((await reopened.list()).map((i) => i.plateNo)).toEqual(['CAB-1', 'CAB-2'])
  })
  it('keeps one queue per account', async () => {
    await queue().enqueue(checkInItem(1))
    expect(await new OfflineQueue('queue:sec2', store()).list()).toEqual([])
  })
})

describe('flushQueue', () => {
  it('sends oldest first, one at a time, and removes what succeeded', async () => {
    const q = queue()
    for (const i of [2, 1, 3]) await q.enqueue(checkInItem(i))
    const order: string[] = []
    let inFlight = 0
    const send = vi.fn(async (item: { plateNo: string }) => {
      inFlight++
      expect(inFlight).toBe(1)
      order.push(item.plateNo)
      await Promise.resolve()
      inFlight--
    })
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 3, failed: 0, stopped: false })
    expect(order).toEqual(['CAB-1', 'CAB-2', 'CAB-3'])
    expect(await q.list()).toEqual([])
  })
  it('a network error is retryable: it stops the run and keeps the item and the order', async () => {
    const q = queue()
    for (const i of [1, 2]) await q.enqueue(checkInItem(i))
    const send = vi.fn().mockRejectedValueOnce(network())
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 0, failed: 0, stopped: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await q.list()).map((i) => [i.plateNo, i.status])).toEqual([['CAB-1', 'waiting'], ['CAB-2', 'waiting']])
    // Next run (back online) sends both; the retry reuses the same requestId.
    send.mockResolvedValue(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toMatchObject({ sent: 2 })
    expect(send.mock.calls.map((c) => (c[0] as { requestId: string }).requestId)).toEqual([checkInItem(1).requestId, checkInItem(1).requestId, checkInItem(2).requestId])
  })
  it('unavailable is retryable too; offline always is', () => {
    expect(isRetryable(new FirebaseError('functions/unavailable', 'unavailable'))).toBe(true)
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryable(typed('internal', 'internal'))).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isRetryable(typed('failed-precondition', 'pass-not-approved'))).toBe(true)
  })
  it('a typed server refusal is final: marked failed with a readable message, kept, and the run goes on', async () => {
    const q = queue()
    for (const i of [1, 2]) await q.enqueue(checkInItem(i))
    const send = vi.fn().mockRejectedValueOnce(typed('failed-precondition', 'pass-not-approved')).mockResolvedValueOnce(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 1, failed: 1, stopped: false })
    expect(await q.list()).toMatchObject([{ plateNo: 'CAB-1', status: 'failed', error: 'This pass is not approved any more. Review it again.' }])
    // Failed items are not resent; they wait for "Dismiss".
    send.mockClear()
    await flushQueue(q, send, classifyGateError)
    expect(send).not.toHaveBeenCalled()
    await q.remove(checkInItem(1).requestId)
    expect(await q.list()).toEqual([])
  })
  it('"already checked in by someone else" reads as a sentence with the time and the guard', () => {
    const at = new Date(2026, 2, 10, 8, 14).getTime()
    expect(gateErrorMessage(typed('already-exists', 'pass-checked-in', { at, byName: 'Nimal' }))).toMatch(/^Already let in at .*08:14.* by Nimal$/)
  })
})

const visitItem = (type: 'checkInVisit' | 'checkOutVisit', i: number, over: Record<string, unknown> = {}): NewQueueItem =>
  ({
    type,
    requestId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    payload:
      type === 'checkInVisit'
        ? { visitId: `vis_${i}`, vehicleId: `veh_${String(i).padStart(10, '0')}`, gateId: 'main', requestId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}` }
        : { visitId: `vis_${i}`, requestId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
    capturedAtISO: '2026-03-10T08:00:00.000Z',
    plateNo: `CAB-${i}`,
    vehicleId: `veh_${String(i).padStart(10, '0')}`,
    createdAt: 2000 + i,
    ...over,
  }) as NewQueueItem

const unloadItem = (i: number, payload: Record<string, unknown>, over: Record<string, unknown> = {}): NewQueueItem =>
  ({
    type: 'logUnloading',
    requestId: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    payload: { visitId: 'vis_a', ...payload },
    capturedAtISO: '2026-03-10T08:00:00.000Z',
    plateNo: 'CAB-1',
    vehicleId: 'veh_0000000001',
    createdAt: 3000 + i,
    ...over,
  }) as NewQueueItem

describe('OfflineQueue: repeat movements', () => {
  it('queues check-in again and check-out, oldest first, next to check-ins', async () => {
    const q = queue()
    await q.enqueue(visitItem('checkOutVisit', 2))
    await q.enqueue(visitItem('checkInVisit', 1))
    await q.enqueue(checkInItem(3))
    expect((await q.list()).map((i) => i.type)).toEqual(['checkIn', 'checkInVisit', 'checkOutVisit'])
  })
  it('dedupes: same requestId, a second waiting re-entry for the vehicle, a second waiting check-out for the visit', async () => {
    const q = queue()
    await q.enqueue(visitItem('checkInVisit', 1))
    expect(await q.enqueue(visitItem('checkInVisit', 1))).toMatchObject({ duplicate: true })
    expect(await q.enqueue(visitItem('checkInVisit', 1, { requestId: 'other' }))).toMatchObject({ duplicate: true })
    await q.enqueue(visitItem('checkOutVisit', 2))
    expect(await q.enqueue(visitItem('checkOutVisit', 2, { requestId: 'other2' }))).toMatchObject({ duplicate: true })
    expect(await q.list()).toHaveLength(2)
  })
  it('flush: success removes, a network error stops and keeps the same request id, a typed refusal is final', async () => {
    const q = queue()
    await q.enqueue(visitItem('checkOutVisit', 1))
    await q.enqueue(visitItem('checkInVisit', 2))
    await q.enqueue(visitItem('checkOutVisit', 3))
    const send = vi.fn().mockRejectedValueOnce(network())
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 0, failed: 0, stopped: true })
    expect(await q.list()).toHaveLength(3)
    send.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(typed('failed-precondition', 'gate-time-over')).mockResolvedValueOnce(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 2, failed: 1, stopped: false })
    expect(await q.list()).toMatchObject([{ type: 'checkInVisit', status: 'failed' }])
  })
})

describe('OfflineQueue: logUnloading', () => {
  it('queues the answer with ids and the plate only', async () => {
    const q = queue()
    await q.enqueue(unloadItem(1, { unloaded: true, unloadLocation: 'Bay 5' }))
    const [item] = await q.list()
    expect(item).toMatchObject({ type: 'logUnloading', status: 'waiting', payload: { visitId: 'vis_a', unloaded: true, unloadLocation: 'Bay 5' } })
    expect(JSON.stringify(item)).not.toMatch(/driverName|photo/i)
  })
  it('keeps the latest answer for the same visit and its place in line', async () => {
    const q = queue()
    await q.enqueue(unloadItem(1, { unloaded: false }))
    await q.enqueue(checkInItem(9))
    const r = await q.enqueue(unloadItem(2, { unloaded: true, unloadLocation: 'Bay 5' }))
    expect(r).toMatchObject({ ok: true, duplicate: false })
    const list = await q.list()
    expect(list).toHaveLength(2)
    expect(list.find((i) => i.type === 'logUnloading')).toMatchObject({ payload: { unloaded: true, unloadLocation: 'Bay 5' }, createdAt: 3001 })
  })
  it('different visits do not replace each other; a failed one is not replaced', async () => {
    const q = queue()
    await q.enqueue(unloadItem(1, { unloaded: false }))
    await q.enqueue(unloadItem(2, { unloaded: false, visitId: 'vis_b' }))
    expect(await q.list()).toHaveLength(2)
    await q.markFailed(unloadItem(1, {}).requestId, 'nope')
    await q.enqueue(unloadItem(3, { unloaded: true, unloadLocation: 'Bay 1' }))
    expect(await q.list()).toHaveLength(3)
  })
  it('flush: sends once, retries after a network error, a typed refusal is kept as failed', async () => {
    const q = queue()
    await q.enqueue(unloadItem(1, { unloaded: false }))
    const send = vi.fn().mockRejectedValueOnce(network())
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 0, failed: 0, stopped: true })
    send.mockResolvedValue(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 1, failed: 0, stopped: false })
    expect(await q.list()).toEqual([])
    await q.enqueue(unloadItem(2, { unloaded: false }))
    send.mockRejectedValueOnce(typed('failed-precondition', 'visit-not-found'))
    expect(await flushQueue(q, send, classifyGateError)).toMatchObject({ failed: 1 })
    expect((await q.list())[0]).toMatchObject({ status: 'failed' })
  })
})
