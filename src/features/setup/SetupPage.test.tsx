import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CODE = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEF'.slice(0, 43)
const validate = vi.hoisted(() => vi.fn())
const complete = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn())
const sendVerification = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
let session: unknown = null
let status = 'signedOut'

vi.mock('@/lib/api', () => ({ validateSetupInvite: (...a: unknown[]) => validate(...a), completeSetup: (...a: unknown[]) => complete(...a) }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'auth' } }))
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: (...a: unknown[]) => signIn(...a) }))
vi.mock('@/lib/emailActions', () => ({ sendVerificationEmail: (...a: unknown[]) => sendVerification(...a) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ status, session, signOut }) }))

import SetupPage from './SetupPage'

const apiError = (reason: string, code = 'functions/failed-precondition') => Object.assign(new FirebaseError(code, 'x'), { details: { reason } })
const Where = () => {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const openWith = (hash: string) => window.history.replaceState({ keep: 1 }, '', `/setup${hash}`)
const fill = (over: Record<string, string> = {}) => {
  const v = { 'Company name': 'Acme Quarry', 'Your full name': 'Ada Admin', 'Work email': 'ada@acme.test', Password: 'Correct-horse-battery-9', 'Confirm password': 'Correct-horse-battery-9', ...over }
  for (const [label, value] of Object.entries(v)) {
    const el = screen.getByLabelText(label)
    if (!(el as HTMLInputElement).readOnly) fireEvent.change(el, { target: { value } })
  }
}
const submit = async () => fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  session = null
  status = 'signedOut'
  validate.mockResolvedValue({ valid: true })
  signIn.mockResolvedValue({ user: { getIdToken: vi.fn(async () => 't') } })
  sendVerification.mockResolvedValue(undefined)
  complete.mockResolvedValue({ tenantId: 'ten_abcde12345' })
  openWith(`#code=${CODE}`)
})

describe('SetupPage: the invite code', () => {
  it('is removed from the address bar immediately, kept in memory only, and sent to validateSetupInvite', async () => {
    renderPage()
    expect(window.location.hash).toBe('') // before validation even resolves
    expect(window.location.href).not.toContain(CODE)
    expect(window.history.state).toEqual({ keep: 1 }) // the router's history state is untouched
    await screen.findByLabelText('Company name')
    expect(validate).toHaveBeenCalledWith({ code: CODE })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(CODE)
  })
  it('adds noindex and no-referrer meta tags while open and removes them after', async () => {
    const { unmount } = renderPage()
    await screen.findByLabelText('Company name')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/noindex/)
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
  it.each([
    ['no code', () => openWith(''), undefined],
    ['a malformed code', () => openWith('#code=short'), undefined],
    ['a code in the query string', () => window.history.replaceState(null, '', `/setup?code=${CODE}`), undefined],
    ['a rejected code', () => undefined, { valid: false }],
  ])('shows the uniform message for %s', async (_n, setup, response) => {
    setup()
    if (response) validate.mockResolvedValue(response)
    renderPage()
    expect(await screen.findByText('This setup link is invalid or has expired.')).toBeInTheDocument()
    expect(screen.getByText('Ask your ConvoyPass contact for a new link.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Company name')).toBeNull()
  })
  it('picks up a new link pasted into an open /setup tab (a fragment change, no reload)', async () => {
    openWith('')
    renderPage()
    expect(await screen.findByText('This setup link is invalid or has expired.')).toBeInTheDocument()
    expect(validate).not.toHaveBeenCalled()
    openWith(`#code=${CODE}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(await screen.findByLabelText('Company name')).toBeInTheDocument()
    expect(validate).toHaveBeenCalledWith({ code: CODE })
    expect(window.location.hash).toBe('')
  })
  it('shows the same message when the check itself fails', async () => {
    validate.mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByText('This setup link is invalid or has expired.')).toBeInTheDocument()
  })
})

describe('SetupPage: signed in', () => {
  it('says who is signed in and offers Sign out instead of the form', async () => {
    status = 'signedIn'
    session = { profile: { name: 'Sam Supervisor', email: 's@x.test' } }
    renderPage()
    expect(await screen.findByText("You're signed in as Sam Supervisor. Sign out to set up a new workspace.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Company name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})

describe('SetupPage: the form', () => {
  it('prefills the company hint and locks the email when the invite has one', async () => {
    validate.mockResolvedValue({ valid: true, companyHint: 'Acme Quarry', emailLock: 'ada@acme.test' })
    renderPage()
    const email = (await screen.findByLabelText('Work email')) as HTMLInputElement
    expect(email.value).toBe('ada@acme.test')
    expect(email.readOnly).toBe(true)
    expect((screen.getByLabelText('Company name') as HTMLInputElement).value).toBe('Acme Quarry')
  })
  it('updates the password rules live: length, not the email, not too common', async () => {
    renderPage()
    await screen.findByLabelText('Company name')
    const met = () => [...screen.getByTestId('password-rules').querySelectorAll('li')].map((li) => li.getAttribute('data-met'))
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ada@acme.test' } })
    expect(met()).toEqual(['false', 'true', 'true'])
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-horse-9' } })
    expect(met()).toEqual(['true', 'true', 'true'])
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Ada@Acme.test' } })
    expect(met()).toEqual(['true', 'false', 'true'])
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1234' } })
    expect(met()).toEqual(['true', 'true', 'false'])
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'abc' } })
    expect(met()).toEqual(['false', 'true', 'true'])
  })
  it('blocks a mismatch and a weak password without calling the server', async () => {
    renderPage()
    await screen.findByLabelText('Company name')
    fill({ 'Confirm password': 'Different-password-1' })
    await submit()
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    fill({ Password: 'Password1234', 'Confirm password': 'Password1234' })
    await submit()
    expect(await screen.findByText('Choose a password that meets every rule below.')).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
  })
  it('creates the workspace, signs in, refreshes the token, sends a verification email and lands on the dashboard', async () => {
    const getIdToken = vi.fn(async () => 't')
    signIn.mockResolvedValue({ user: { getIdToken } })
    renderPage()
    await screen.findByLabelText('Company name')
    fill({ 'Work email': ' Ada@Acme.test ' })
    await submit()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/dashboard?welcome=1'))
    expect(complete).toHaveBeenCalledWith({
      code: CODE, companyName: 'Acme Quarry', adminName: 'Ada Admin', email: 'ada@acme.test', password: 'Correct-horse-battery-9', timezone: 'Asia/Colombo',
    })
    expect(signIn).toHaveBeenCalledWith({ name: 'auth' }, 'ada@acme.test', 'Correct-horse-battery-9')
    expect(getIdToken).toHaveBeenCalledWith(true)
    expect(sendVerification).toHaveBeenCalledTimes(1)
    expect(localStorage.length).toBe(0)
  })
  it('does not flash the signed-in notice while it signs the new admin in', async () => {
    renderPage()
    await screen.findByLabelText('Company name')
    signIn.mockImplementation(async () => {
      status = 'signedIn'
      session = { profile: { name: 'Ada Admin' } }
      return { user: { getIdToken: async () => 't' } }
    })
    fill()
    await submit()
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument())
    expect(screen.queryByText(/Sign out to set up a new workspace/)).toBeNull()
  })
  it('ignores a second click while the first is in flight', async () => {
    let finish!: (v: { tenantId: string }) => void
    complete.mockReturnValue(new Promise((r) => (finish = r)))
    renderPage()
    await screen.findByLabelText('Company name')
    fill()
    await submit()
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    const busy = screen.getByRole('button', { name: /Creating your workspace/ })
    expect(busy).toBeDisabled()
    fireEvent.submit(busy.closest('form') as HTMLFormElement) // Enter key / programmatic submit
    fireEvent.submit(busy.closest('form') as HTMLFormElement)
    expect(complete).toHaveBeenCalledTimes(1)
    finish({ tenantId: 't' })
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument())
  })
  it('maps server answers to friendly messages and lets the person try again', async () => {
    renderPage()
    await screen.findByLabelText('Company name')
    fill()
    complete.mockRejectedValueOnce(apiError('email-exists', 'functions/already-exists'))
    await submit()
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument()
    complete.mockRejectedValueOnce(apiError('rate-limited', 'functions/resource-exhausted'))
    await submit()
    expect(await screen.findByText('Too many attempts. Please wait a while and try again.')).toBeInTheDocument()
    complete.mockRejectedValueOnce(new FirebaseError('functions/internal', 'internal: secret detail'))
    await submit()
    expect(await screen.findByText('We could not complete the setup. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/secret detail/)).toBeNull()
    complete.mockRejectedValueOnce(apiError('common-password', 'functions/invalid-argument'))
    await submit()
    expect(await screen.findByText('That password is too common. Choose another.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })
  it('falls back to the uniform invalid page when the server says the link is no good any more', async () => {
    renderPage()
    await screen.findByLabelText('Company name')
    fill()
    complete.mockRejectedValueOnce(apiError('setup-invalid'))
    await submit()
    expect(await screen.findByText('This setup link is invalid or has expired.')).toBeInTheDocument()
  })
})
