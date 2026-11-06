import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.hoisted(() => vi.fn())
const fbSignOut = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined))
const getProfile = vi.hoisted(() => vi.fn())
const signupStatus = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ value: { status: 'signedOut', operator: null, session: null } as Record<string, unknown> }))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: (...a: unknown[]) => signIn(...a), signOut: (...a: unknown[]) => fbSignOut(...a) }))
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }))
vi.mock('@/lib/api', () => ({ getOperatorProfile: (...a: unknown[]) => getProfile(...a), getSuperAdminSignupStatus: (...a: unknown[]) => signupStatus(...a) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => authState.value }))

import PlatformLoginPage from './PlatformLoginPage'

const MISMATCH = "These details don't match a super admin account."
const OP_CLAIMS = { role: 'platform', platformAdmin: true }
const credential = (claims: Record<string, unknown>) => ({ user: { getIdTokenResult: vi.fn(async () => ({ claims })) } })
const authError = (code: string) => new FirebaseError(code, 'x')

const Where = () => {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderAt = (url = '/platform/login') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const fill = (email = 'olive@convoypass.test', password = 'whatever-123') => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.value = { status: 'signedOut', operator: null, session: null }
  getProfile.mockResolvedValue({ name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: false })
  signupStatus.mockResolvedValue({ enabled: false })
})

describe('Super admin sign-in page', () => {
  it('is labelled as the Super admin sign-in and sets noindex / no-referrer', () => {
    renderAt()
    expect(screen.getByRole('heading', { name: 'Super admin sign-in' })).toBeInTheDocument()
    expect(screen.getAllByText(/Super admin console/i).length).toBeGreaterThan(0)
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex')
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
  })
  it('shows and hides the password', () => {
    renderAt()
    const input = screen.getByLabelText('Password') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input.type).toBe('text')
  })
  it('a valid super admin reads fresh claims, calls getOperatorProfile and lands on /platform', async () => {
    const cred = credential(OP_CLAIMS)
    signIn.mockResolvedValue(cred)
    renderAt()
    fill()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform'))
    expect(cred.user.getIdTokenResult).toHaveBeenCalledWith(true)
    expect(getProfile).toHaveBeenCalled()
    expect(fbSignOut).not.toHaveBeenCalled()
  })
  it('a tenant user gets the SAME message as a wrong password, and is signed out at once', async () => {
    signIn.mockResolvedValue(credential({ role: 'admin', tenantId: 'T1' }))
    const tenant = renderAt()
    fill('admin@acme.test')
    const tenantMsg = (await screen.findByRole('alert')).textContent
    expect(tenantMsg).toContain(MISMATCH)
    expect(fbSignOut).toHaveBeenCalledTimes(1)
    expect(getProfile).not.toHaveBeenCalled() // never even asks the server about a workspace account
    tenant.unmount()

    fbSignOut.mockClear()
    signIn.mockRejectedValue(authError('auth/invalid-credential'))
    renderAt()
    fill('olive@convoypass.test', 'wrong-password-1')
    const wrongMsg = (await screen.findByRole('alert')).textContent
    expect(wrongMsg).toBe(tenantMsg)
  })
  it('an unknown email, a disabled account and a refused profile all show that message too', async () => {
    for (const fail of [
      () => signIn.mockRejectedValue(authError('auth/user-not-found')),
      () => signIn.mockRejectedValue(authError('auth/user-disabled')),
      () => {
        signIn.mockResolvedValue(credential(OP_CLAIMS))
        getProfile.mockRejectedValue(Object.assign(authError('functions/permission-denied'), { details: { reason: 'forbidden' } }))
      },
      () => signIn.mockResolvedValue(credential({ role: 'platform', platformAdmin: true, tenantId: 'T1' })),
    ]) {
      fail()
      const r = renderAt()
      fill()
      expect((await screen.findByRole('alert')).textContent).toContain(MISMATCH)
      r.unmount()
    }
  })
  it('a dropped connection and rate limiting are the only differences', async () => {
    signIn.mockRejectedValue(authError('auth/network-request-failed'))
    const a = renderAt()
    fill()
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server')
    a.unmount()
    signIn.mockRejectedValue(authError('auth/too-many-requests'))
    renderAt()
    fill()
    expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts')
  })
  it('validates the fields before calling Firebase', () => {
    renderAt()
    fill('not-an-email', '')
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })
  it('returns to a `from` inside /platform and ignores one outside it', async () => {
    signIn.mockResolvedValue(credential(OP_CLAIMS))
    const a = renderAt('/platform/login?from=%2Fplatform%2Fworkspaces')
    fill()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform/workspaces'))
    a.unmount()
    for (const from of ['%2Fadmin%2Fdashboard', '%2F%2Fevil.com', 'https%3A%2F%2Fevil.com']) {
      const r = renderAt(`/platform/login?from=${from}`)
      fill()
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform'))
      r.unmount()
    }
  })
  it('after a stale-login redirect it explains why, stays for the password even when still signed in, and returns', async () => {
    authState.value = { status: 'signedIn', operator: { uid: 'o1', name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: false }, session: null }
    signIn.mockResolvedValue(credential(OP_CLAIMS))
    renderAt('/platform/login?from=%2Fplatform%2Finvites&reason=reauth')
    expect(screen.getByText(/sign in again to continue/i)).toBeInTheDocument()
    fill()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform/invites'))
  })
  it('an already signed-in super admin is sent on without a form', () => {
    authState.value = { status: 'signedIn', operator: { uid: 'o1', name: 'Olive', email: 'o@x.test', mustChangePassword: false }, session: null }
    renderAt('/platform/login?from=%2Fplatform%2Finvites')
    expect(screen.getByTestId('where').textContent).toBe('/platform/invites')
  })
  it('a signed-in workspace user still sees the form (nothing hints that they could go anywhere else)', () => {
    authState.value = { status: 'signedIn', operator: null, session: { claims: { role: 'admin' } } }
    renderAt()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
  it('never links to the workspace login or the privacy page of the tenant app, and hides signup while it is off', async () => {
    renderAt()
    await waitFor(() => expect(signupStatus).toHaveBeenCalled())
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
  it('offers the signup link only when the server says signup is on', async () => {
    signupStatus.mockResolvedValue({ enabled: true })
    renderAt()
    const link = await screen.findByRole('link', { name: 'Create a super admin account' })
    expect(link.getAttribute('href')).toBe('/platform/signup')
  })
})
