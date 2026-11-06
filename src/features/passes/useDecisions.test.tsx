import { act, renderHook } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePass } from '@/test/passFactory'

const decidePass = vi.fn()
const bulkApprove = vi.fn()
const revokePass = vi.fn()
vi.mock('@/lib/api', () => ({ decidePass: (...a: unknown[]) => decidePass(...a), bulkApprove: (...a: unknown[]) => bulkApprove(...a), revokePass: (...a: unknown[]) => revokePass(...a) }))
vi.mock('@/lib/firebase', () => ({}))
const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('sonner', () => ({ toast: { success: (m: string) => toast.success(m), error: (m: string) => toast.error(m) } }))

import { useDecisions } from './useDecisions'

const callError = (reason: string) => Object.assign(new FirebaseError('functions/failed-precondition', 'x'), { details: { reason } })

beforeEach(() => vi.clearAllMocks())

describe('useDecisions', () => {
  it('approve sends what the reviewer was looking at and hides the pass at once', async () => {
    let resolve!: () => void
    decidePass.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const pass = makePass({ id: 'p1', attempt: 3 })
    const { result } = renderHook(() => useDecisions())
    let outcome: Promise<unknown>
    act(() => { outcome = result.current.approve(pass) })
    expect(decidePass).toHaveBeenCalledWith({ passId: 'p1', action: 'approve', expectedStatus: 'submitted', expectedAttempt: 3 })
    expect(result.current.isHidden(pass)).toBe(true) // optimistic
    expect(result.current.busyOf('p1')).toBe('approve')
    await act(async () => { resolve(); await outcome })
    expect(result.current.isHidden(pass)).toBe(true)
    expect(result.current.busyOf('p1')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('WP LJ-4821 approved')
  })

  it('rolls back and explains when the server refuses', async () => {
    decidePass.mockRejectedValue(new FirebaseError('functions/permission-denied', 'no'))
    const pass = makePass({ id: 'p1' })
    const { result } = renderHook(() => useDecisions())
    let out: unknown
    await act(async () => { out = await result.current.approve(pass) })
    expect(out).toMatchObject({ outcome: 'error' })
    expect(result.current.isHidden(pass)).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('a "changed" error shows the review-again message and brings the pass back', async () => {
    decidePass.mockRejectedValue(callError('pass-changed'))
    const pass = makePass({ id: 'p1' })
    const { result } = renderHook(() => useDecisions())
    let out: unknown
    await act(async () => { out = await result.current.approve(pass) })
    expect(out).toMatchObject({ outcome: 'changed' })
    expect(toast.error).toHaveBeenCalledWith('This pass changed. Please review it again.')
    expect(result.current.isHidden(pass)).toBe(false)
  })

  it('a resubmission (new attempt) of a decided pass is not hidden', async () => {
    decidePass.mockResolvedValue({})
    const pass = makePass({ id: 'p1', attempt: 1 })
    const { result } = renderHook(() => useDecisions())
    await act(async () => { await result.current.approve(pass) })
    expect(result.current.isHidden(pass)).toBe(true)
    expect(result.current.isHidden({ ...pass, attempt: 2 })).toBe(false)
  })

  it('ignores a second decision on a pass that is already in flight', async () => {
    let resolve!: () => void
    decidePass.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const pass = makePass({ id: 'p1' })
    const { result } = renderHook(() => useDecisions())
    let first: Promise<unknown>
    act(() => { first = result.current.approve(pass) })
    await act(async () => { await result.current.approve(pass) })
    expect(decidePass).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(); await first })
  })

  it('reject sends the reason and note; inline errors are not toasted', async () => {
    decidePass.mockRejectedValue(new FirebaseError('functions/permission-denied', 'no'))
    const pass = makePass({ id: 'p1' })
    const { result } = renderHook(() => useDecisions())
    await act(async () => { await result.current.reject(pass, { reasonCode: 'other', note: 'Mud on plate' }, { inline: true }) })
    expect(decidePass).toHaveBeenCalledWith({ passId: 'p1', action: 'reject', expectedStatus: 'submitted', expectedAttempt: 1, reasonCode: 'other', note: 'Mud on plate' })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('bulk: hides everything, then brings back only the ones that failed', async () => {
    const a = makePass({ id: 'a' })
    const b = makePass({ id: 'b' })
    bulkApprove.mockResolvedValue({ results: [{ passId: 'a', ok: true }, { passId: 'b', ok: false, error: 'pass-changed' }] })
    const { result } = renderHook(() => useDecisions())
    let res: unknown
    await act(async () => { res = await result.current.approveMany([a, b]) })
    expect(bulkApprove).toHaveBeenCalledWith({ items: [{ passId: 'a', expectedAttempt: 1 }, { passId: 'b', expectedAttempt: 1 }] })
    expect(res).toHaveLength(2)
    expect(result.current.isHidden(a)).toBe(true)
    expect(result.current.isHidden(b)).toBe(false)
  })

  it('bulk: a failed call brings everything back', async () => {
    bulkApprove.mockRejectedValue(new Error('offline'))
    const a = makePass({ id: 'a' })
    const { result } = renderHook(() => useDecisions())
    let res: unknown
    await act(async () => { res = await result.current.approveMany([a]) })
    expect(res).toBeNull()
    expect(result.current.isHidden(a)).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('revoke calls revokePass with the attempt on screen', async () => {
    revokePass.mockResolvedValue({})
    const pass = makePass({ id: 'p1', status: 'officer_approved', attempt: 2 })
    const { result } = renderHook(() => useDecisions())
    await act(async () => { await result.current.revoke(pass, { reasonCode: 'photo_not_fresh' }) })
    expect(revokePass).toHaveBeenCalledWith({ passId: 'p1', expectedAttempt: 2, reasonCode: 'photo_not_fresh' })
    expect(toast.success).toHaveBeenCalledWith('WP LJ-4821 approval revoked')
  })
})
