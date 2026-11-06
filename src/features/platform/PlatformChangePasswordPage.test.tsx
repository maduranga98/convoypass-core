import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const change = vi.hoisted(() => vi.fn())
const reauth = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn(async () => undefined))
const refreshOperator = vi.hoisted(() => vi.fn(async () => undefined))
const op = vi.hoisted(() => ({ value: { uid: 'o1', name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: true } }))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: (...a: unknown[]) => signIn(...(a as [])) }))
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: vi.fn(async () => 't') } } }))
vi.mock('@/lib/api', () => ({ changeOwnPassword: (...a: unknown[]) => change(...a) }))
vi.mock('./reauth', async (orig) => ({ ...(await orig<typeof import('./reauth')>()), reauthenticate: (...a: unknown[]) => reauth(...a) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ operator: op.value, refreshOperator }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import PlatformChangePasswordPage from './PlatformChangePasswordPage'

const NEW = 'Correct-Horse-Battery-9'
const Where = () => <p data-testid="where">{useLocation().pathname + useLocation().search}</p>
const renderPage = (url = '/platform/change-password') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/platform/change-password" element={<PlatformChangePasswordPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const fill = (current = 'Temp-Passw0rd-xyz', next = NEW, confirm = next) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New password', { selector: 'input' }), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

beforeEach(() => {
  vi.clearAllMocks()
  op.value = { uid: 'o1', name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: true }
  reauth.mockResolvedValue(undefined)
  change.mockResolvedValue({ ok: true })
})

describe('Super admin change password', () => {
  it('explains the forced change and hides the way back while it is forced', () => {
    renderPage()
    expect(screen.getByText(/temporary password/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to the console' })).toBeNull()
  })
  it('keeps the button off until the new password has 14+ characters, is not the email and is not common', () => {
    renderPage()
    const button = screen.getByRole('button', { name: 'Change password' })
    fill('x', 'short')
    expect(button).toBeDisabled()
    fill('x', 'olive@convoypass.test')
    expect(button).toBeDisabled()
    fill('x', NEW)
    expect(button).not.toBeDisabled()
  })
  it('re-authenticates with the current password, changes it, signs in again, refreshes the profile and goes on', async () => {
    renderPage('/platform/change-password?next=%2Fplatform%2Finvites')
    fill()
    submit()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform/invites'))
    expect(reauth).toHaveBeenCalledWith('Temp-Passw0rd-xyz')
    expect(change).toHaveBeenCalledWith({ newPassword: NEW })
    expect(signIn).toHaveBeenCalled()
    expect(refreshOperator).toHaveBeenCalled()
    expect(reauth.mock.invocationCallOrder[0]!).toBeLessThan(change.mock.invocationCallOrder[0]!)
  })
  it('ignores a `next` outside /platform', async () => {
    renderPage('/platform/change-password?next=%2Fadmin')
    fill()
    submit()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/platform'))
  })
  it('mismatching confirmation is refused before anything is called', () => {
    renderPage()
    fill('x', NEW, `${NEW}!`)
    submit()
    expect(screen.getByRole('alert').textContent).toContain('do not match')
    expect(reauth).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
  })
  it('a wrong current password stops before the change', async () => {
    const { WrongPassword } = await import('./reauth')
    reauth.mockRejectedValue(new WrongPassword())
    renderPage()
    fill()
    submit()
    expect((await screen.findByRole('alert')).textContent).toContain('not your current password')
    expect(change).not.toHaveBeenCalled()
  })
  it('a stale login sends the operator to the sign-in page, which returns here', async () => {
    change.mockRejectedValue(Object.assign(new FirebaseError('functions/failed-precondition', 'x'), { details: { reason: 'recent-login-required' } }))
    renderPage()
    fill()
    submit()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('reason=reauth'))
  })
  it('offers the way back when the change is voluntary', () => {
    op.value = { ...op.value, mustChangePassword: false }
    renderPage()
    expect(screen.getByRole('link', { name: 'Back to the console' })).toBeInTheDocument()
  })
})
