import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const status = vi.hoisted(() => vi.fn())
const signUp = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined))
const authState = vi.hoisted(() => ({ value: { status: 'signedOut', operator: null } as Record<string, unknown> }))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: (...a: unknown[]) => signIn(...a) }))
vi.mock('@/lib/firebase', () => ({ auth: {} }))
vi.mock('@/lib/api', () => ({ getSuperAdminSignupStatus: (...a: unknown[]) => status(...a), signUpSuperAdmin: (...a: unknown[]) => signUp(...a) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => authState.value }))

import PlatformSignupPage from './PlatformSignupPage'

const PW = 'Correct-Horse-Battery-9'
const Where = () => <p data-testid="where">{useLocation().pathname}</p>
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/platform/signup']}>
      <Routes>
        <Route path="/platform/signup" element={<PlatformSignupPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const fill = (over: { name?: string; email?: string; password?: string; confirm?: string } = {}) => {
  const v = { name: 'Olive', email: 'olive@convoypass.test', password: PW, confirm: PW, ...over }
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: v.name } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: v.email } })
  fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: v.password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: v.confirm } })
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

beforeEach(() => {
  vi.clearAllMocks()
  authState.value = { status: 'signedOut', operator: null }
  status.mockResolvedValue({ enabled: true })
  signUp.mockResolvedValue({ ok: true })
})

describe('Super admin signup page', () => {
  it('creates the account, signs in and lands on /platform', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Create a super admin account' })
    fill()
    submit()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform'))
    expect(signUp).toHaveBeenCalledWith({ name: 'Olive', email: 'olive@convoypass.test', password: PW })
    expect(signIn).toHaveBeenCalledWith(expect.anything(), 'olive@convoypass.test', PW)
  })
  it('keeps the button off until the password meets every requirement and both passwords match', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Create a super admin account' })
    const button = screen.getByRole('button', { name: 'Create account' })
    fill({ password: 'short', confirm: 'short' })
    expect(button).toBeDisabled()
    fill({ password: 'olive@convoypass.test', confirm: 'olive@convoypass.test' })
    expect(button).toBeDisabled()
    fill({ confirm: '' })
    expect(button).toBeDisabled()
    fill()
    expect(button).not.toBeDisabled()
  })
  it('checks name, email and confirmation before calling the server', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Create a super admin account' })
    fill({ name: ' ', email: 'nope', confirm: `${PW}x` })
    submit()
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })
  it('shows the server refusal (email already registered) and does not sign in', async () => {
    signUp.mockRejectedValue(Object.assign(new FirebaseError('functions/already-exists', 'x'), { details: { reason: 'email-exists' } }))
    renderPage()
    await screen.findByRole('heading', { name: 'Create a super admin account' })
    fill()
    submit()
    expect((await screen.findByRole('alert')).textContent).toContain('already registered')
    expect(signIn).not.toHaveBeenCalled()
  })
  it('says signup is turned off, with no form, when the server switch is off or unreachable', async () => {
    for (const make of [() => status.mockResolvedValue({ enabled: false }), () => status.mockRejectedValue(new Error('down'))]) {
      make()
      const r = renderPage()
      await screen.findByRole('heading', { name: 'Signup is turned off' })
      expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
      r.unmount()
    }
  })
  it('sends a signed-in super admin straight to the console', () => {
    authState.value = { status: 'signedIn', operator: { uid: 'o1' } }
    renderPage()
    expect(screen.getByTestId('where').textContent).toBe('/platform')
  })
})
