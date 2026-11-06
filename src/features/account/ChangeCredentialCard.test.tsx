import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const order: string[] = []
const reauth = vi.hoisted(() => vi.fn())
const signInWithEmailAndPassword = vi.hoisted(() => vi.fn())
const changeOwnPassword = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const getIdToken = vi.hoisted(() => vi.fn(async () => 't'))
const user = vi.hoisted(() => ({ email: 'ada@acme.test' as string | null, getIdToken: null as unknown }))
const authMock = vi.hoisted(() => ({ currentUser: null as unknown }))
let role = 'admin'

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/firebase', () => ({ auth: authMock }))
vi.mock('@/lib/api', () => ({ changeOwnPassword: (...a: unknown[]) => changeOwnPassword(...a) }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { role, tenantId: 'T1' }, profile: { email: 'ada@acme.test' } }) }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
  reauthenticateWithCredential: (...a: unknown[]) => reauth(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => signInWithEmailAndPassword(...a),
}))

import { ChangeCredentialCard } from './ChangeCredentialCard'

const GOOD = 'Correct-horse-battery-9'
const fillAndSubmit = async (current: string, next: string, confirm = next, labels = ['Current password', 'New password', 'Confirm new password']) => {
  fireEvent.change(screen.getByLabelText(labels[0] as string), { target: { value: current } })
  fireEvent.change(screen.getByLabelText(labels[1] as string), { target: { value: next } })
  fireEvent.change(screen.getByLabelText(labels[2] as string), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /^Update password$/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  role = 'admin'
  user.email = 'ada@acme.test'
  user.getIdToken = getIdToken
  authMock.currentUser = user
  reauth.mockImplementation(async (_u: unknown, cred: { password: string }) => void order.push(`reauth:${cred.password}`))
  getIdToken.mockImplementation(async () => {
    order.push('token')
    return 't'
  })
  changeOwnPassword.mockImplementation(async () => void order.push('change'))
})

describe('ChangeCredentialCard (staff)', () => {
  it('re-authenticates with the current password and refreshes the token BEFORE calling changeOwnPassword, then stays signed in', async () => {
    render(<ChangeCredentialCard />)
    await fillAndSubmit('Old-password-1234', GOOD)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password updated. You stay signed in on this device.'))
    expect(order).toEqual(['reauth:Old-password-1234', 'token', 'change', `reauth:${GOOD}`, 'token'])
    expect(changeOwnPassword).toHaveBeenCalledWith({ newPassword: GOOD })
    expect(reauth.mock.calls[0]?.[0]).toBe(user)
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled()
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('') // form reset
  })

  it('a wrong current password fails without changing anything', async () => {
    reauth.mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'x'))
    render(<ChangeCredentialCard />)
    await fillAndSubmit('wrong-password-123', GOOD)
    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument()
    expect(changeOwnPassword).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('too many attempts and network problems get their own messages', async () => {
    reauth.mockRejectedValueOnce(new FirebaseError('auth/too-many-requests', 'x'))
    render(<ChangeCredentialCard />)
    await fillAndSubmit('Old-password-1234', GOOD)
    expect(await screen.findByText('Too many attempts. Please wait a moment and try again.')).toBeInTheDocument()
    reauth.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'x'))
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('Network problem. Check your connection and try again.')).toBeInTheDocument()
    expect(changeOwnPassword).not.toHaveBeenCalled()
  })

  it.each([
    ['a short password', 'short', 'Choose a password that meets every rule below.'],
    ['a common password', 'Password1234', 'Choose a password that meets every rule below.'],
    ['the email address', 'ada@acme.test', 'Choose a password that meets every rule below.'],
  ])('rejects %s before any network call', async (_n, next, message) => {
    render(<ChangeCredentialCard />)
    await fillAndSubmit('Old-password-1234', next)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(reauth).not.toHaveBeenCalled()
    expect(changeOwnPassword).not.toHaveBeenCalled()
  })

  it('requires the current password, a matching confirmation and a different new password', async () => {
    render(<ChangeCredentialCard />)
    await fillAndSubmit('', GOOD)
    expect(await screen.findByText('Enter your current password')).toBeInTheDocument()
    await fillAndSubmit('Old-password-1234', GOOD, 'something-else-1')
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    await fillAndSubmit(GOOD, GOOD)
    expect(await screen.findByText('Choose something different from your current one.')).toBeInTheDocument()
    expect(changeOwnPassword).not.toHaveBeenCalled()
  })

  it('shows the server refusal (for example recent-login-required) and keeps the user signed in', async () => {
    changeOwnPassword.mockRejectedValueOnce(Object.assign(new FirebaseError('functions/failed-precondition', 'x'), { details: { reason: 'recent-login-required' } }))
    render(<ChangeCredentialCard />)
    await fillAndSubmit('Old-password-1234', GOOD)
    expect(await screen.findByText('Please sign in again, then change your password.')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('falls back to a fresh sign-in if re-authenticating with the new password fails', async () => {
    reauth.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new FirebaseError('auth/user-token-expired', 'x'))
    render(<ChangeCredentialCard />)
    await fillAndSubmit('Old-password-1234', GOOD)
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(authMock, 'ada@acme.test', GOOD)
  })
})
