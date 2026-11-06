// Module 12: the security top bar shows the gate choice only for several gates and the queue only when it has items;
// sound and sign-out live in the menu.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const g = vi.hoisted(() => ({ gates: [{ id: 'main', name: 'Main Gate' }] as { id: string; name: string }[], queue: [] as unknown[], sound: true }))
const signOut = vi.hoisted(() => vi.fn())
const setSound = vi.hoisted(() => vi.fn())
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'sec' }), useAuth: () => ({ signOut }) }))
vi.mock('@/features/notifications/Bell', () => ({ Bell: () => <button type="button">Notifications</button> }))
vi.mock('@/features/passes/useOnline', () => ({ useOnline: () => true }))
vi.mock('./useGate', () => ({ useGates: () => ({ gates: g.gates, gate: g.gates[0] ?? null, setGate: vi.fn() }) }))
vi.mock('./gateQueue', () => ({ useOfflineQueue: () => g.queue }))
vi.mock('./deviceSettings', () => ({ useSoundOn: () => [g.sound, setSound] }))

import { GateTopBar } from './GateTopBar'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.clearAllMocks()
  g.gates = [{ id: 'main', name: 'Main Gate' }]
  g.queue = []
})
const bar = () => render(<MemoryRouter><GateTopBar /></MemoryRouter>)

describe('GateTopBar', () => {
  it('one gate: no gate picker; empty queue: no queue button; no loose sound or sign-out buttons', () => {
    bar()
    expect(screen.queryByRole('button', { name: /change gate|choose gate/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /offline queue/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /sound/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })
  it('several gates show the picker; queued items show the queue', () => {
    g.gates = [{ id: 'main', name: 'Main Gate' }, { id: 'north', name: 'North Gate' }]
    g.queue = [{ status: 'waiting' }]
    bar()
    expect(screen.getByRole('button', { name: /Change gate/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Offline queue/ })).toBeInTheDocument()
  })
  it('the menu holds the sound toggle, Settings and Sign out', () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sound on' }))
    expect(setSound).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})
