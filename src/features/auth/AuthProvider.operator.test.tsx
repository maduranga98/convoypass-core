import { render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (u: unknown) => void
const state = vi.hoisted(() => ({ listener: null as null | ((u: unknown) => void), signOut: vi.fn(async () => undefined) }))
const getProfile = vi.hoisted(() => vi.fn())

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: Listener) => { state.listener = cb; return () => undefined },
  signOut: () => state.signOut(),
}))
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn(), onSnapshot: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/api', () => ({ getOperatorProfile: (...a: unknown[]) => getProfile(...a) }))
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: vi.fn() } }))
vi.mock('@/features/notifications/push/registration', () => ({ releaseDeviceOnSignOut: vi.fn() }))

import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

const Probe = () => {
  const { status, session, operator, notice } = useAuth()
  return <p data-testid="p">{[status, session ? 'tenant' : 'no-tenant', operator?.email ?? 'no-operator', notice ?? 'no-notice'].join('|')}</p>
}
const user = (claims: Record<string, unknown>) => ({ uid: 'u1', getIdTokenResult: async () => ({ claims }) })
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)
const OP = { role: 'platform', platformAdmin: true, email_verified: true }

beforeEach(() => { vi.clearAllMocks(); state.listener = null })

describe('AuthProvider: platform operator', () => {
  it('signs an operator in from getOperatorProfile: no tenant session, no users doc read', async () => {
    getProfile.mockResolvedValue({ name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: false })
    mount()
    state.listener?.(user(OP))
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('signedIn|no-tenant|olive@convoypass.test|no-notice'))
  })
  it('signs out a disabled, missing or unverified operator (the server refuses getOperatorProfile)', async () => {
    getProfile.mockRejectedValue(Object.assign(new FirebaseError('functions/permission-denied', 'x'), { details: { reason: 'forbidden' } }))
    mount()
    state.listener?.(user(OP))
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
    expect(screen.getByTestId('p').textContent).not.toContain('signedIn')
    expect(screen.getByTestId('p').textContent).toContain('disabled')
  })
  it('treats a platform token that also carries a tenant as no operator at all', async () => {
    mount()
    state.listener?.(user({ ...OP, tenantId: 'T1' }))
    await waitFor(() => expect(state.signOut).toHaveBeenCalled())
    expect(getProfile).not.toHaveBeenCalled()
  })
  it('exposes a pending password change, and drops one-time secrets when the session ends', async () => {
    const { useSensitiveState } = await import('@/features/platform/sensitive')
    const cleared = vi.fn()
    const Secret = () => {
      useSensitiveState(cleared)
      return null
    }
    getProfile.mockResolvedValue({ name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: true })
    const Pending = () => <p data-testid="m">{String(useAuth().operator?.mustChangePassword)}</p>
    render(<AuthProvider><Probe /><Pending /><Secret /></AuthProvider>)
    state.listener?.(user(OP))
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('true'))
    state.listener?.(null)
    await waitFor(() => expect(cleared).toHaveBeenCalled())
  })
})
