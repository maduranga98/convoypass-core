import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckInSuccess } from './CheckInSuccess'

const info = { plateNo: 'WP LJ-4821', atMs: new Date(2026, 2, 10, 8, 14).getTime(), offline: false, guardName: 'Sam', gateName: 'Main Gate' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const tick = async (ms: number) => {
  for (let i = 0; i < ms / 1000; i++) await act(async () => void vi.advanceTimersByTime(1000))
}

describe('CheckInSuccess', () => {
  it('counts down 3 seconds, then moves on to the next scan', async () => {
    const onNext = vi.fn()
    render(<CheckInSuccess info={info} next="scan" onNext={onNext} />)
    expect(screen.getByText('Scanning next in 3…')).toBeInTheDocument()
    expect(screen.getByText('WP LJ-4821')).toBeInTheDocument()
    expect(screen.getByText('By Sam')).toBeInTheDocument()
    await tick(2000)
    expect(onNext).not.toHaveBeenCalled()
    await tick(1000)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('a tap cancels the countdown; Continue moves on', async () => {
    const onNext = vi.fn()
    render(<CheckInSuccess info={info} next="home" onNext={onNext} />)
    expect(screen.getByText('Back to the list in 3…')).toBeInTheDocument()
    await tick(1000)
    fireEvent.click(screen.getByText('WP LJ-4821'))
    await tick(5000)
    expect(onNext).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('an offline check-in says it will sync and labels the time as device time', () => {
    render(<CheckInSuccess info={{ ...info, offline: true }} next="scan" onNext={vi.fn()} />)
    expect(screen.getByText('Saved offline, will sync')).toBeInTheDocument()
    expect(screen.getByText('(device time)')).toBeInTheDocument()
  })
})
