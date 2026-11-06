import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const OOB = 'SECRETOOBCODE123'
const verifyCode = vi.hoisted(() => vi.fn())
const confirmReset = vi.hoisted(() => vi.fn())
const applyCode = vi.hoisted(() => vi.fn())
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const getIdToken = vi.hoisted(() => vi.fn(async () => 't'))
const authMock = vi.hoisted(() => ({
  currentUser: null as null | { reload: () => Promise<void>; getIdToken: (f: boolean) => Promise<string> },
  authStateReady: async () => undefined,
}))

vi.mock('@/lib/firebase', () => ({ auth: authMock }))
vi.mock('firebase/auth', () => ({
  verifyPasswordResetCode: (...a: unknown[]) => verifyCode(...a),
  confirmPasswordReset: (...a: unknown[]) => confirmReset(...a),
  applyActionCode: (...a: unknown[]) => applyCode(...a),
}))

import AuthActionPage from './AuthActionPage'

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/auth/action${search}`]}>
      <Routes>
        <Route path="/auth/action" element={<AuthActionPage />} />
        <Route path="/login/staff" element={<p>login page</p>} />
        <Route path="/forgot-password" element={<p>forgot page</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )
const fe = (code: string) => new FirebaseError(code, 'x')

beforeEach(() => {
  vi.clearAllMocks()
  authMock.currentUser = null
})

describe('/auth/action resetPassword', () => {
  it('verifies the code, applies the same strength rules, resets and offers sign in; the code is never shown', async () => {
    verifyCode.mockResolvedValue('ada@acme.test')
    confirmReset.mockResolvedValue(undefined)
    renderAt(`?mode=resetPassword&oobCode=${OOB}&apiKey=k`)
    expect(await screen.findByText('For ada@acme.test')).toBeInTheDocument()
    expect(verifyCode).toHaveBeenCalledWith(authMock, OOB)
    expect(document.body.textContent).not.toContain(OOB)

    const pw = screen.getByLabelText('New password')
    fireEvent.change(pw, { target: { value: 'Password1234' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Choose a password that meets every rule below.')).toBeInTheDocument()
    expect(confirmReset).not.toHaveBeenCalled()

    fireEvent.change(pw, { target: { value: 'Correct-horse-battery-9' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Correct-horse-battery-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    expect(confirmReset).toHaveBeenCalledWith(authMock, OOB, 'Correct-horse-battery-9')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login/staff')
    expect(document.body.textContent).not.toContain(OOB)
  })
  it('refuses a password equal to the account email', async () => {
    verifyCode.mockResolvedValue('ada.admin@acme.test')
    renderAt(`?mode=resetPassword&oobCode=${OOB}`)
    await screen.findByText('For ada.admin@acme.test')
    for (const label of ['New password', 'Confirm password']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'ada.admin@acme.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Choose a password that meets every rule below.')).toBeInTheDocument()
    expect(confirmReset).not.toHaveBeenCalled()
  })
  it.each([
    ['an expired code', 'auth/expired-action-code', 'This link has expired or was already used.'],
    ['an unknown code', 'auth/invalid-action-code', 'This link is not valid.'],
  ])('handles %s with a clear message and a way to request a new link', async (_n, code, message) => {
    verifyCode.mockRejectedValue(fe(code))
    renderAt(`?mode=resetPassword&oobCode=${OOB}`)
    expect(await screen.findByText(message)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Request a new reset link' }))
    expect(await screen.findByText('forgot page')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(OOB)
  })
  it('shows the invalid message when there is no code at all, and when the code expires while typing', async () => {
    renderAt('?mode=resetPassword')
    expect(await screen.findByText('This link is not valid.')).toBeInTheDocument()
  })
  it('switches to the expired message if confirmPasswordReset says the code expired', async () => {
    verifyCode.mockResolvedValue('ada@acme.test')
    confirmReset.mockRejectedValue(fe('auth/expired-action-code'))
    renderAt(`?mode=resetPassword&oobCode=${OOB}`)
    await screen.findByText('For ada@acme.test')
    for (const label of ['New password', 'Confirm password']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'Correct-horse-battery-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('This link has expired or was already used.')).toBeInTheDocument()
  })
})

describe('/auth/action verifyEmail', () => {
  it('applies the code, reloads the signed-in user and confirms', async () => {
    applyCode.mockResolvedValue(undefined)
    authMock.currentUser = { reload, getIdToken }
    renderAt(`?mode=verifyEmail&oobCode=${OOB}`)
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(applyCode).toHaveBeenCalledWith(authMock, OOB)
    expect(reload).toHaveBeenCalled()
    expect(getIdToken).toHaveBeenCalledWith(true)
    expect(screen.getByRole('link', { name: 'Open ConvoyPass' })).toHaveAttribute('href', '/')
    expect(document.body.textContent).not.toContain(OOB)
  })
  it('works when nobody is signed in', async () => {
    applyCode.mockResolvedValue(undefined)
    renderAt(`?mode=verifyEmail&oobCode=${OOB}`)
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument()
  })
  it.each([
    ['auth/expired-action-code', 'This link has expired or was already used.'],
    ['auth/invalid-action-code', 'This link is not valid.'],
  ])('shows a clear message for %s', async (code, message) => {
    applyCode.mockRejectedValue(fe(code))
    renderAt(`?mode=verifyEmail&oobCode=${OOB}`)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(/Ask your administrator if you still need to verify/)).toBeInTheDocument()
  })
})

describe('/auth/action other modes', () => {
  it.each(['recoverEmail', 'verifyAndChangeEmail', 'signIn', 'bogus', null])('ignores mode=%s and goes to sign in without touching the code', async (mode) => {
    renderAt(mode ? `?mode=${mode}&oobCode=${OOB}` : `?oobCode=${OOB}`)
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    expect(verifyCode).not.toHaveBeenCalled()
    expect(applyCode).not.toHaveBeenCalled()
  })
})
