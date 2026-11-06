import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendResetEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/emailActions', () => ({ sendResetEmail: (...a: unknown[]) => sendResetEmail(...a) }))
vi.mock('@/lib/firebase', () => ({ auth: {} }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ status: 'signedOut', session: null }) }))

import ForgotPasswordPage from './ForgotPasswordPage'

const SENT = "If an account exists for this email, we've sent a reset link."
const renderPage = () => render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
const send = async (email: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  sendResetEmail.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('ForgotPasswordPage', () => {
  it('shows the identical confirmation for a known email, an unknown email and a server error', async () => {
    const texts: (string | null)[] = []
    const outcomes: (() => Promise<void>)[] = [
      async () => void sendResetEmail.mockResolvedValueOnce(undefined),
      async () => void sendResetEmail.mockRejectedValueOnce(new FirebaseError('auth/user-not-found', 'x')),
      async () => void sendResetEmail.mockRejectedValueOnce(new FirebaseError('auth/internal-error', 'x')),
      async () => void sendResetEmail.mockRejectedValueOnce(new FirebaseError('auth/too-many-requests', 'x')),
    ]
    for (const setup of outcomes) {
      await setup()
      const { container, unmount } = renderPage()
      await send('someone@acme.test')
      const note = await screen.findByText(SENT)
      texts.push(container.textContent)
      expect(note).toBeInTheDocument()
      expect(screen.queryByText(/not found|no account|doesn't exist|does not exist/i)).toBeNull()
      unmount()
    }
    expect(new Set(texts).size).toBe(1)
  })

  it('says so only when the network is down, and does not start the cooldown', async () => {
    sendResetEmail.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'x'))
    renderPage()
    await send('someone@acme.test')
    expect(await screen.findByText('Network problem. Check your connection and try again.')).toBeInTheDocument()
    expect(screen.queryByText(SENT)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled()
  })

  it('validates the email before sending anything', async () => {
    renderPage()
    await send('not-an-email')
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
    expect(sendResetEmail).not.toHaveBeenCalled()
  })

  it('enforces a 60-second cooldown on sending again', async () => {
    sendResetEmail.mockResolvedValue(undefined)
    renderPage()
    await send(' someone@acme.test ')
    await screen.findByText(SENT)
    expect(sendResetEmail).toHaveBeenCalledWith('someone@acme.test')
    const again = screen.getByRole('button', { name: /Send again in \d+ s/ })
    expect(again).toBeDisabled()
    await act(async () => void vi.advanceTimersByTime(59_000))
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled()
    await act(async () => void vi.advanceTimersByTime(2_000))
    const ready = await screen.findByRole('button', { name: 'Send again' })
    expect(ready).toBeEnabled()
    fireEvent.click(ready)
    await waitFor(() => expect(sendResetEmail).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled()
  })

  it('is for office staff only: no PIN talk, and back goes to the staff sign-in', () => {
    renderPage()
    expect(screen.queryByText(/PIN/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login/staff')
  })
})
