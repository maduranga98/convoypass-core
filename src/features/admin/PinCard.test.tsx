// Module 12: the one-time PIN card (create and reissue).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const createUser = vi.hoisted(() => vi.fn())
const reissuePin = vi.hoisted(() => vi.fn())
const users = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('@/lib/appUrl', () => ({ appBase: { url: 'https://app.convoypass.test' } }))
vi.mock('@/lib/api', () => ({ createUser: (...a: unknown[]) => createUser(...a), reissuePin: (...a: unknown[]) => reissuePin(...a), updateUser: vi.fn(), resetCredential: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'adminA', claims: { role: 'admin', tenantId: 'T1' }, profile: {} }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { name: 'Acme Cement' } }) }))
vi.mock('./queries', () => ({
  useUsers: () => ({ isPending: false, isError: false, data: users.data, refetch: vi.fn() }),
  useContractors: () => ({ isPending: false, isError: false, data: [{ id: 'c1', name: 'Haul Co', status: 'active' }] }),
}))

import { clearSensitiveState } from '@/features/platform/sensitive'
import { CreateUserDrawer } from './CreateUserDrawer'
import { PinCardModal } from './PinCard'
import UsersPage from './UsersPage'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.clearAllMocks()
  users.data = []
})

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
const ISSUED = { pin: '48291736', name: 'Dan Driver', role: 'driver' as const, company: 'Haul Co' }

describe('PIN card', () => {
  it('shows 1234 5678, name, role and company, with Copy, WhatsApp and Print', () => {
    render(<PinCardModal issued={ISSUED} onDone={vi.fn()} />)
    expect(screen.getByTestId('pin-value')).toHaveTextContent('4829 1736')
    for (const text of ['Dan Driver', 'Driver', 'Haul Co']) expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print card' })).toBeInTheDocument()
    const wa = screen.getByRole('link', { name: 'Share by WhatsApp' })
    expect(wa.getAttribute('href')).toBe(
      `https://wa.me/?text=${encodeURIComponent('Hello Dan Driver, your ConvoyPass PIN is 4829 1736. Open https://app.convoypass.test and type it in. Keep it private.')}`,
    )
  })

  it('cannot be dismissed: no close button, Escape does nothing; only "I\'ve given it to them" closes it', () => {
    const onDone = vi.fn()
    render(<PinCardModal issued={ISSUED} onDone={onDone} />)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    fireEvent.click(dialog) // backdrop
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: "I've given it to them" }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('the print view has a QR code of the app URL only, never the PIN', () => {
    render(<PinCardModal issued={ISSUED} onDone={vi.fn()} />)
    const print = screen.getByTestId('pin-print')
    expect(print).toHaveTextContent('Haul Co')
    expect(print).toHaveTextContent('Dan Driver')
    expect(print).toHaveTextContent('4829 1736')
    expect(print).toHaveTextContent('https://app.convoypass.test')
    const qr = within(print).getByTestId('pin-print-qr')
    expect(qr.getAttribute('data-value')).toBe('https://app.convoypass.test')
    expect(qr.outerHTML).not.toContain('48291736')
    expect(qr.outerHTML).not.toContain('4829 1736')
  })

  it('copies the message with the PIN', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PinCardModal issued={ISSUED} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('4829 1736')))
  })
})

describe('Create user: driver and security get a PIN card', () => {
  it('asks only for name, contact number (optional) and contractor; no password', () => {
    render(wrap(<CreateUserDrawer open onClose={vi.fn()} />))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'driver' } })
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.getByLabelText(/Contact number/)).toBeInTheDocument()
    expect(screen.getByLabelText('Contractor')).toBeInTheDocument()
  })

  it('shows the PIN once; after confirming it is gone from the page', async () => {
    createUser.mockResolvedValue({ uid: 'u9', pin: '48291736' })
    const onClose = vi.fn()
    render(wrap(<CreateUserDrawer open onClose={onClose} />))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'security' } })
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sam Guard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }))
    expect(await screen.findByTestId('pin-value')).toHaveTextContent('4829 1736')
    expect(createUser).toHaveBeenCalledWith({ role: 'security', name: 'Sam Guard' })
    expect(screen.getAllByText('Acme Cement').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: "I've given it to them" }))
    expect(onClose).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('4829')
  })

  it('is cleared from memory when the session ends', async () => {
    createUser.mockResolvedValue({ uid: 'u9', pin: '48291736' })
    render(wrap(<CreateUserDrawer open onClose={vi.fn()} />))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'security' } })
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sam Guard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }))
    await screen.findByTestId('pin-value')
    act(() => clearSensitiveState())
    expect(document.body.textContent).not.toContain('4829')
  })
})

describe('Users page: Reissue PIN', () => {
  const row = (id: string, role: string, over: Record<string, unknown> = {}) => ({
    id, tenantId: 'T1', role, name: `${id} name`, email: role === 'officer' ? `${id}@x.test` : null, phone: null, contractorId: role === 'driver' ? 'c1' : null, status: 'active', mustChangePassword: false, ...over,
  })

  it('drivers and security get "Reissue PIN" with a confirmation, then the new PIN card; staff keep Reset password', async () => {
    users.data = [row('drv', 'driver'), row('sec', 'security'), row('off', 'officer')]
    reissuePin.mockResolvedValue({ pin: '59302847' })
    render(wrap(<UsersPage />))
    // The table renders a desktop and a mobile layout: each action appears in both.
    expect(screen.getAllByRole('button', { name: 'Reissue PIN: drv name' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Reset password: off name' }).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: 'Reset password: drv name' })).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reissue PIN: sec name' })[0] as HTMLElement)
    expect(screen.getByText('sec name gets a new PIN. This signs them out on every phone.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reissue PIN' }))
    expect(await screen.findByTestId('pin-value')).toHaveTextContent('5930 2847')
    expect(reissuePin).toHaveBeenCalledWith({ uid: 'sec' })
  })

  it('shows "Last signed in" and the device count for PIN users', () => {
    const at = { toDate: () => new Date('2026-10-01T08:30:00Z') }
    users.data = [row('drv', 'driver', { lastLoginAt: at, knownDevices: { a: {}, b: {} } }), row('sec', 'security')]
    render(wrap(<UsersPage />))
    expect(screen.getAllByText('2 phones').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Never').length).toBeGreaterThan(0)
  })
})
