// Module 12: PIN sessions (drivers 90 days, security 16 hours), reissued PINs and `session-expired` from a callable.
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (u: unknown) => void
const state = vi.hoisted(() => ({
  listener: null as null | ((u: unknown) => void),
  signOut: vi.fn(async () => undefined),
  userDoc: {} as Record<string, unknown>,
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: Listener) => { state.listener = cb; return () => undefined },
  signOut: () => state.signOut(),
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: async () => ({ data: () => ({ tenantId: 'T1', status: 'active' }) }),
  onSnapshot: (ref: string, next: (s: unknown) => void) => {
    if (ref.startsWith('users/')) next({ id: 'u1', data: () => state.userDoc })
    return () => undefined
  },
}))
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/api', () => ({ getOperatorProfile: vi.fn() }))
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: vi.fn() } }))
vi.mock('@/features/notifications/push/registration', () => ({ releaseDeviceOnSignOut: vi.fn() }))

import { reportSessionExpired } from '@/lib/sessionEvents'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

const Probe = () => {
  const { status, notice } = useAuth()
  return <p data-testid="p">{[status, notice ?? 'no-notice'].join('|')}</p>
}
const nowS = () => Math.floor(Date.now() / 1000)
const user = (role: string, ageSeconds: number) => ({
  uid: 'u1',
  getIdTokenResult: async () => ({
    claims: { role, tenantId: 'T1', ...(role === 'driver' ? { contractorId: 'C1' } : {}) },
    authTime: new Date((nowS() - ageSeconds) * 1000).toUTCString(),
  }),
})
const doc = (role: string, over: Record<string, unknown> = {}) => ({
  tenantId: 'T1', role, contractorId: role === 'driver' ? 'C1' : null, name: 'N', status: 'active', mustChangePassword: false, loginType: 'pin', ...over,
})
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  state.listener = null
})

describe('AuthProvider: PIN sessions', () => {
  it('a driver session younger than 90 days stays signed in; older is signed out with "Please enter your PIN again."', async () => {
    state.userDoc = doc('driver')
    const a = mount()
    act(() => state.listener?.(user('driver', 89 * 86400)))
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('signedIn|no-notice'))
    a.unmount()
    mount()
    act(() => state.listener?.(user('driver', 90 * 86400 + 60)))
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
    expect(screen.getByTestId('p').textContent).toContain('Please enter your PIN again.')
  })

  it('a security session older than 16 hours is signed out', async () => {
    state.userDoc = doc('security')
    mount()
    act(() => state.listener?.(user('security', 16 * 3600 + 60)))
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
  })

  it('office staff have no session limit', async () => {
    state.userDoc = doc('officer', { loginType: 'password' })
    mount()
    act(() => state.listener?.(user('officer', 400 * 86400)))
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('signedIn|no-notice'))
    expect(state.signOut).not.toHaveBeenCalled()
  })

  it('a reissued PIN (sessionsRevokedAt after this sign-in) ends the session', async () => {
    state.userDoc = doc('security', { sessionsRevokedAt: nowS() })
    mount()
    act(() => state.listener?.(user('security', 600)))
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
    expect(screen.getByTestId('p').textContent).toContain('Please enter your PIN again.')
  })

  it('a session-expired error from any callable signs out with the PIN notice', async () => {
    state.userDoc = doc('driver')
    mount()
    act(() => state.listener?.(user('driver', 60)))
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('signedIn|no-notice'))
    act(() => reportSessionExpired())
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
    expect(screen.getByTestId('p').textContent).toContain('Please enter your PIN again.')
  })
})
