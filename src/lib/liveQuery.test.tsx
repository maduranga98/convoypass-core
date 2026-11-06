import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveQuery, type Subscribe } from './liveQuery'

vi.mock('firebase/firestore', () => ({ onSnapshot: vi.fn() }))

const setup = () => {
  let push: (v: number) => void = () => undefined
  let fail: (e: unknown) => void = () => undefined
  const unsubscribe = vi.fn()
  const subscribe = vi.fn<Subscribe<number>>((next, onError) => {
    push = next
    fail = onError
    return unsubscribe
  })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { subscribe, unsubscribe, wrapper, push: (v: number) => act(() => push(v)), fail: (e: unknown) => act(() => fail(e)) }
}

describe('useLiveQuery', () => {
  it('is pending until the first snapshot, then follows every change without a reload', async () => {
    const s = setup()
    const { result } = renderHook(() => useLiveQuery(['k'], s.subscribe), { wrapper: s.wrapper })
    expect(result.current.isPending).toBe(true)
    s.push(1)
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(result.current.isPending).toBe(false)
    s.push(2)
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(s.subscribe).toHaveBeenCalledTimes(1)
  })

  it('stops listening when the screen goes away', () => {
    const s = setup()
    const { unmount } = renderHook(() => useLiveQuery(['k'], s.subscribe), { wrapper: s.wrapper })
    unmount()
    expect(s.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not listen while disabled', () => {
    const s = setup()
    renderHook(() => useLiveQuery(['k'], s.subscribe, false), { wrapper: s.wrapper })
    expect(s.subscribe).not.toHaveBeenCalled()
  })

  it('reports a listener error, and refetch listens again', async () => {
    const s = setup()
    const { result } = renderHook(() => useLiveQuery(['k'], s.subscribe), { wrapper: s.wrapper })
    s.fail(new Error('permission-denied'))
    expect(result.current.isError).toBe(true)
    expect(result.current.error?.message).toBe('permission-denied')
    act(() => void result.current.refetch())
    expect(s.subscribe).toHaveBeenCalledTimes(2)
    s.push(5)
    await waitFor(() => expect(result.current.data).toBe(5))
    expect(result.current.isError).toBe(false)
  })

  it('a new key starts a new listener', () => {
    const s = setup()
    const { rerender } = renderHook(({ k }) => useLiveQuery([k], s.subscribe), { wrapper: s.wrapper, initialProps: { k: 'a' } })
    rerender({ k: 'b' })
    expect(s.subscribe).toHaveBeenCalledTimes(2)
    expect(s.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
