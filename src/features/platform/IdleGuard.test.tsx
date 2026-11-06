import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ signOut }) }))

import { IDLE_LIMIT_MS, IDLE_WARNING_MS, IdleGuard } from './IdleGuard'
import { peekLoginReason, setLoginReason } from './redirect'
import { clearSensitiveState, useSensitiveState } from './sensitive'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const MIN = 60_000
const Secret = ({ onClear }: { onClear: () => void }) => {
  useSensitiveState(onClear)
  return <p>one-time card</p>
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setLoginReason(undefined)
})
afterEach(() => vi.useRealTimers())

describe('super admin idle timeout', () => {
  it('uses 30 minutes with a one minute warning', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * MIN)
    expect(IDLE_WARNING_MS).toBe(MIN)
  })
  it('stays quiet while the operator is active', () => {
    render(<IdleGuard />)
    for (let i = 0; i < 40; i++) {
      advance(MIN)
      fireEvent.keyDown(window)
    }
    expect(screen.queryByText('Still there?')).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })
  it('warns with a countdown one minute before, then signs out and clears the one-time secrets', () => {
    const cleared = vi.fn()
    render(<><IdleGuard /><Secret onClear={cleared} /></>)
    advance(29 * MIN - 1000)
    expect(screen.queryByText('Still there?')).toBeNull()
    advance(2000)
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/signed out in \d+ seconds?/)
    advance(30_000)
    expect(screen.getByRole('alert').textContent).toMatch(/signed out in (29|30|31) seconds/)
    expect(signOut).not.toHaveBeenCalled()
    advance(31_000)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(cleared).toHaveBeenCalledTimes(1)
    expect(peekLoginReason()).toBe('idle')
  })
  it('pointer, key, touch and scroll all count as activity', () => {
    render(<IdleGuard />)
    for (const [name, fire] of [
      ['pointerdown', () => fireEvent.pointerDown(window)],
      ['keydown', () => fireEvent.keyDown(window)],
      ['touchstart', () => fireEvent.touchStart(window)],
      ['scroll', () => fireEvent.scroll(window)],
    ] as const) {
      advance(20 * MIN)
      fire()
      advance(1000)
      expect(signOut, name).not.toHaveBeenCalled()
    }
  })
  it('once the warning is up, a nudged mouse does not hide it; "Stay signed in" does and restarts the clock', () => {
    render(<IdleGuard />)
    advance(29 * MIN + 5000)
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    fireEvent.pointerMove(window)
    advance(1000)
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    expect(screen.queryByText('Still there?')).toBeNull()
    advance(25 * MIN)
    expect(signOut).not.toHaveBeenCalled()
    advance(5 * MIN + 2000)
    expect(signOut).toHaveBeenCalledTimes(1)
  })
  it('"Sign out now" signs out at once and clears secrets', () => {
    const cleared = vi.fn()
    render(<><IdleGuard /><Secret onClear={cleared} /></>)
    advance(29 * MIN + 2000)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out now' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(cleared).toHaveBeenCalled()
  })
  it('stops listening when the console unmounts', () => {
    const { unmount } = render(<IdleGuard />)
    unmount()
    advance(31 * MIN)
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('clearSensitiveState', () => {
  it('calls every registered clear, survives one that throws, and forgets unmounted ones', () => {
    const a = vi.fn(() => { throw new Error('boom') })
    const b = vi.fn()
    const gone = vi.fn()
    const { unmount } = render(<><Secret onClear={a} /><Secret onClear={b} /></>)
    render(<Secret onClear={gone} />).unmount()
    clearSensitiveState()
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
    expect(gone).not.toHaveBeenCalled()
    unmount()
  })
})
