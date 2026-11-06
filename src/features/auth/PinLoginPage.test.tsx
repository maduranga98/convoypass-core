import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loginWithPin = vi.hoisted(() => vi.fn())
const signInWithCustomToken = vi.hoisted(() => vi.fn(async () => undefined))
const clearNotice = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ value: { status: 'signedOut', operator: null, session: null, notice: null } as Record<string, unknown> }))

vi.mock('firebase/auth', () => ({ signInWithCustomToken: (...a: unknown[]) => signInWithCustomToken(...(a as [])) }))
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }))
vi.mock('@/lib/api', () => ({ loginWithPin: (...a: unknown[]) => loginWithPin(...a) }))
vi.mock('@/lib/deviceId', () => ({ deviceId: () => '0b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b' }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ ...authState.value, clearNotice }) }))

import PinLoginPage from './PinLoginPage'

const Where = () => {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderAt = (url = '/login') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<PinLoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

const keypad = () => within(screen.getByRole('group', { name: 'Number keys' }))
const tap = (digits: string) => {
  for (const d of digits) fireEvent.click(keypad().getByRole('button', { name: d }))
}
const boxes = () => screen.getByTestId('pin-boxes').querySelectorAll('span')
const shown = () => [...boxes()].map((b) => b.textContent).join('')
const refusal = (details: Record<string, unknown>) =>
  Object.assign(new FirebaseError('functions/unauthenticated', "That PIN didn't work. Check it or ask your supervisor."), { details })

let online = true
beforeEach(() => {
  vi.clearAllMocks()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  authState.value = { status: 'signedOut', operator: null, session: null, notice: null }
  loginWithPin.mockResolvedValue({ token: 'custom-token' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PIN screen', () => {
  it('shows the logo, "Enter your PIN", eight boxes in two groups of four and a keypad with 0-9 and delete', () => {
    renderAt()
    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeInTheDocument()
    expect(boxes()).toHaveLength(8)
    expect(boxes()[4]?.className).toContain('ml-2')
    expect(boxes()[3]?.className).not.toContain('ml-2')
    for (const d of '0123456789') expect(keypad().getByRole('button', { name: d })).toBeInTheDocument()
    expect(keypad().getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByText(/email/i, { selector: 'h1, label' })).toBeNull()
  })

  it('sends automatically on the 8th digit, with a spinner and a disabled keypad', async () => {
    let finish: (v: { token: string }) => void = () => undefined
    loginWithPin.mockImplementation(() => new Promise((r) => (finish = r)))
    renderAt()
    tap('4829173')
    expect(loginWithPin).not.toHaveBeenCalled()
    tap('6')
    expect(loginWithPin).toHaveBeenCalledWith({ pin: '48291736', deviceId: '0b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b' })
    expect(screen.getByRole('status')).toHaveTextContent('Checking…')
    expect(keypad().getByRole('button', { name: '1' })).toBeDisabled()
    await act(async () => finish({ token: 'custom-token' }))
    expect(signInWithCustomToken).toHaveBeenCalledWith({ currentUser: null }, 'custom-token')
  })

  it('delete removes the last digit', () => {
    renderAt()
    tap('482')
    fireEvent.click(keypad().getByRole('button', { name: 'Delete' }))
    expect(shown()).toBe('••')
  })

  it('accepts a paste with spaces (and a real keyboard)', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: ' 4829 1736 ' } })
    await waitFor(() => expect(loginWithPin).toHaveBeenCalledWith({ pin: '48291736', deviceId: expect.any(String) }))
  })

  it('masks digits as dots; the eye button reveals them', () => {
    renderAt()
    tap('482')
    expect(shown()).toBe('•••')
    expect(screen.getByLabelText('PIN')).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show PIN' }))
    expect(shown()).toBe('482')
    expect(screen.getByRole('button', { name: 'Hide PIN' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a wrong PIN clears the boxes, shakes, and shows the one generic message', async () => {
    loginWithPin.mockRejectedValue(refusal({ reason: 'pin-invalid' }))
    renderAt()
    tap('13572468')
    expect(await screen.findByText("That PIN didn't work. Check it or ask your supervisor.")).toBeInTheDocument()
    expect(shown()).toBe('')
    expect(screen.getByTestId('pin-boxes').className).toContain('animate-shake')
    expect(signInWithCustomToken).not.toHaveBeenCalled()
  })

  it('a lockout shows the wait in minutes and a countdown, and keeps the keypad disabled until it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    loginWithPin.mockRejectedValue(refusal({ reason: 'pin-invalid', retryAfterSeconds: 120 }))
    renderAt()
    tap('13572468')
    expect(await screen.findByText('Too many tries. Please wait 2 minutes, or ask your supervisor.')).toBeInTheDocument()
    expect(screen.getByText('Try again in 2:00')).toBeInTheDocument()
    expect(keypad().getByRole('button', { name: '5' })).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(screen.getByText('Too many tries. Please wait 1 minute, or ask your supervisor.')).toBeInTheDocument()
    expect(keypad().getByRole('button', { name: '5' })).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(keypad().getByRole('button', { name: '5' })).toBeEnabled()
    expect(screen.queryByText(/Too many tries/)).toBeNull()
  })

  it('offline: says there is no internet instead of an error, and sends nothing', async () => {
    online = false
    renderAt()
    tap('48291736')
    expect(await screen.findByText('No internet. Please connect and try again.')).toBeInTheDocument()
    expect(loginWithPin).not.toHaveBeenCalled()
  })

  it('a network failure during the call is the same "no internet" message', async () => {
    loginWithPin.mockRejectedValue(new FirebaseError('functions/unavailable', 'x'))
    renderAt()
    tap('48291736')
    expect(await screen.findByText('No internet. Please connect and try again.')).toBeInTheDocument()
  })

  it('"Office staff? Sign in with email" goes to the staff form and keeps the return URL', () => {
    renderAt('/login?next=%2Fv%2Fveh_abc')
    expect(screen.getByRole('link', { name: 'Office staff? Sign in with email' })).toHaveAttribute('href', '/login/staff?next=%2Fv%2Fveh_abc')
  })

  it('after an expired session it asks for the PIN again', () => {
    authState.value = { ...authState.value, notice: 'Please enter your PIN again.' }
    renderAt('/login?next=%2Fv%2Fveh_abc')
    expect(screen.getByText('Please enter your PIN again.')).toBeInTheDocument()
  })

  it('once signed in, continues to the saved return URL (a scanned vehicle) or the role home', () => {
    authState.value = { status: 'signedIn', operator: null, notice: null, session: { claims: { role: 'driver', tenantId: 'T1', contractorId: 'C1' } } }
    renderAt('/login?next=%2Fv%2Fveh_abcdefghij')
    expect(screen.getByTestId('where')).toHaveTextContent('/v/veh_abcdefghij')
  })

  it('a return URL inside another role’s area is dropped for the role home', () => {
    authState.value = { status: 'signedIn', operator: null, notice: null, session: { claims: { role: 'security', tenantId: 'T1', contractorId: null } } }
    renderAt('/login?next=%2Fadmin%2Fusers')
    expect(screen.getByTestId('where')).toHaveTextContent('/security')
  })
})
