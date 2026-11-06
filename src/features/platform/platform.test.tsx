import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const CODE = 'Qm9ndXNDb2RlQm9ndXNDb2RlQm9ndXNDb2RlQm9ndXNDb2Q'
const LINK = `https://convoypass.com/setup#code=${CODE}`
const createInvite = vi.hoisted(() => vi.fn())
const listInvites = vi.hoisted(() => vi.fn())
const revokeInvite = vi.hoisted(() => vi.fn())
const reauth = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  createSetupInvite: (...a: unknown[]) => createInvite(...a),
  listSetupInvites: (...a: unknown[]) => listInvites(...a),
  revokeSetupInvite: (...a: unknown[]) => revokeInvite(...a),
}))
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { email: 'olive@convoypass.test' } } }))
vi.mock('./reauth', async (orig) => ({ ...(await orig<typeof import('./reauth')>()), reauthenticate: (...a: unknown[]) => reauth(...a) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import InvitesPage from './InvitesPage'

const apiError = (reason: string, code = 'functions/unauthenticated') => Object.assign(new FirebaseError(code, 'x'), { details: { reason } })
const NOW = Date.now()
const DAY = 86_400_000
const row = (over: Record<string, unknown> = {}) => ({
  hashPrefix: 'abcdef12', companyHint: 'Acme Quarry', lockEmail: null, status: 'unused', createdAt: NOW - 1000, expiresAt: NOW + DAY, usedAt: null, tenantId: null, tenantName: null, ...over,
})
const created = () => ({ code: CODE, link: LINK, hashPrefix: 'abcdef12', expiresAt: NOW + 7 * DAY })

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

let qc: QueryClient
const renderPage = () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InvitesPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const submit = async (company = 'Acme Quarry', email = '') => {
  fireEvent.change(await screen.findByLabelText(/Company name/), { target: { value: company } })
  if (email) fireEvent.change(screen.getByLabelText(/Expected admin email/), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  listInvites.mockResolvedValue({ invites: [row()], nextCursor: null })
  createInvite.mockResolvedValue(created())
  revokeInvite.mockResolvedValue({ ok: true })
  reauth.mockResolvedValue(undefined)
})

describe('one-time invite card', () => {
  it('shows the link once with the warning and the share buttons, and sends the right payload', async () => {
    renderPage()
    await submit('Acme Quarry', 'Ada@Acme.test')
    const input = (await screen.findByLabelText('Setup link')) as HTMLInputElement
    expect(input.value).toBe(LINK)
    expect(screen.getByText('This link is shown only once. Anyone who opens it first becomes the admin.')).toBeInTheDocument()
    expect(createInvite).toHaveBeenCalledWith({ companyHint: 'Acme Quarry', lockEmail: 'ada@acme.test', expiresInDays: 7 })

    const wa = screen.getByRole('link', { name: 'Send by WhatsApp' }) as HTMLAnchorElement
    expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true)
    const text = new URL(wa.href).searchParams.get('text') ?? ''
    expect(text).toContain(LINK)
    expect(text).toContain("Open the link on the device you'll use as admin.")
    expect(text).toContain('Acme Quarry')
    expect(wa.rel).toContain('noopener')
    const mail = screen.getByRole('link', { name: 'Send by email' }) as HTMLAnchorElement
    expect(mail.href.startsWith('mailto:ada@acme.test?subject=')).toBe(true)
    expect(new URL(mail.href).searchParams.get('body')).toBe(text)
    // the form cannot be used again while the link is on screen: it would be lost
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeDisabled()
  })
  it('copy puts the link on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await submit()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
  })
  it('clears the code from the page, storage and the query cache when the card is closed', async () => {
    renderPage()
    await submit()
    await screen.findByLabelText('Setup link')
    expect(document.body.innerHTML).toContain(CODE)
    fireEvent.click(screen.getByRole('button', { name: 'Done, hide the link' }))
    await waitFor(() => expect(screen.queryByLabelText('Setup link')).toBeNull())
    expect(document.body.innerHTML).not.toContain(CODE)
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeEnabled()
    for (const store of [localStorage, sessionStorage]) expect(JSON.stringify({ ...store })).not.toContain(CODE)
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(CODE)
    expect(JSON.stringify(qc.getMutationCache().getAll())).not.toContain(CODE)
  })
  it('clears the code when the page is left (unmount)', async () => {
    const { unmount } = renderPage()
    await submit()
    await screen.findByLabelText('Setup link')
    unmount()
    expect(document.body.innerHTML).not.toContain(CODE)
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(CODE)
  })
  it('validates the expected email before calling the server', async () => {
    renderPage()
    await submit('Acme', 'not-an-email')
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(createInvite).not.toHaveBeenCalled()
  })
  it('offers exactly 1, 3, 7, 14 and 30 days, defaulting to 7', async () => {
    renderPage()
    const select = (await screen.findByLabelText('Expires after')) as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['1 day', '3 days', '7 days', '14 days', '30 days'])
    expect(select.value).toBe('7')
  })
})

describe('reauthentication', () => {
  it('asks for the password on reauth-required, then retries the same request once and shows the card', async () => {
    createInvite.mockRejectedValueOnce(apiError('reauth-required')).mockResolvedValueOnce(created())
    renderPage()
    await submit()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sign in again')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'my-password-123' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByLabelText('Setup link')).toBeInTheDocument()
    expect(reauth).toHaveBeenCalledWith('my-password-123')
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(createInvite.mock.calls[1]).toEqual(createInvite.mock.calls[0])
  })
  it('retries only once: a second reauth-required is shown as an error, not looped', async () => {
    createInvite.mockRejectedValue(apiError('reauth-required'))
    renderPage()
    await submit()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw-pw-pw-pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('Setup link')).toBeNull()
  })
  it('a wrong password keeps the dialog open and sends nothing again', async () => {
    createInvite.mockRejectedValueOnce(apiError('reauth-required'))
    const { WrongPassword } = await import('./reauth')
    reauth.mockRejectedValueOnce(new WrongPassword())
    renderPage()
    await submit()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'wrong-wrong' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    expect(await within(dialog).findByText('That password is not right.')).toBeInTheDocument()
    expect(createInvite).toHaveBeenCalledTimes(1)
  })
  it('cancelling the dialog abandons the action quietly', async () => {
    createInvite.mockRejectedValueOnce(apiError('reauth-required'))
    renderPage()
    await submit()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(createInvite).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Setup link')).toBeNull()
  })
  it('revoke goes through the same retry', async () => {
    revokeInvite.mockRejectedValueOnce(apiError('reauth-required')).mockResolvedValueOnce({ ok: true })
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Revoke' }))[0]!)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    const reauthDialog = await screen.findByText('Sign in again')
    fireEvent.change(within(reauthDialog.closest('dialog')!).getByLabelText('Password'), { target: { value: 'my-password-123' } })
    fireEvent.click(within(reauthDialog.closest('dialog')!).getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledTimes(2))
    expect(revokeInvite).toHaveBeenCalledWith({ hashPrefix: 'abcdef12' })
  })
})

describe('invite list', () => {
  it('shows status chips and offers Revoke for unused invites only; an invite past its expiry shows as expired', async () => {
    listInvites.mockResolvedValue({
      invites: [
        row({ hashPrefix: '11111111', companyHint: 'Unused Co' }),
        row({ hashPrefix: '22222222', companyHint: 'Claimed Co', status: 'claimed' }),
        row({ hashPrefix: '33333333', companyHint: 'Used Co', status: 'used', tenantId: 'ten_a', tenantName: 'Used Workspace', usedAt: NOW }),
        row({ hashPrefix: '44444444', companyHint: 'Expired Co', status: 'expired', expiresAt: NOW - 1 }),
        row({ hashPrefix: '55555555', companyHint: 'Stale Co', status: 'unused', expiresAt: NOW - 1000 }),
      ],
      nextCursor: null,
    })
    renderPage()
    await screen.findAllByText('Unused Co')
    const tableRow = (name: string) => screen.getAllByText(name).map((el) => el.closest('tr')).find(Boolean) as HTMLElement
    expect(within(tableRow('Unused Co')).getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    for (const name of ['Claimed Co', 'Used Co', 'Expired Co', 'Stale Co']) expect(within(tableRow(name)).queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(within(tableRow('Stale Co')).getByText('Expired')).toBeInTheDocument()
    expect(within(tableRow('Used Co')).getByText('Used Workspace')).toBeInTheDocument()
  })
  it('filters by status through the server and confirms before revoking', async () => {
    renderPage()
    await screen.findAllByText('Acme Quarry')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'used' } })
    await waitFor(() => expect(listInvites).toHaveBeenLastCalledWith({ status: 'used' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Revoke' }))[0]!)
    expect(revokeInvite).not.toHaveBeenCalled() // the confirm dialog comes first
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith({ hashPrefix: 'abcdef12' }))
  })
  it('has loading-free empty and error states', async () => {
    listInvites.mockResolvedValueOnce({ invites: [], nextCursor: null })
    renderPage()
    expect(await screen.findByText('No invites yet.')).toBeInTheDocument()
  })
  it('shows an error state with a retry', async () => {
    listInvites.mockRejectedValueOnce(new Error('x'))
    renderPage()
    expect(await screen.findByText('Could not load invites.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByText('Acme Quarry')).length).toBeGreaterThan(0)
  })
})
