import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PW = 'Zk7mPq2WvXn8TrBd'
const api = vi.hoisted(() => ({
  createWorkspace: vi.fn(), listTenants: vi.fn(), getWorkspace: vi.fn(), addTenantAdmin: vi.fn(),
  resetTenantAdminCredential: vi.fn(), setTenantAdminStatus: vi.fn(), updateTenantAdmin: vi.fn(),
}))
const reauth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { email: 'olive@convoypass.test' } } }))
vi.mock('./reauth', async (orig) => ({ ...(await orig<typeof import('./reauth')>()), reauthenticate: (...a: unknown[]) => reauth(...a) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CredentialsCard } from './CredentialsCard'
import { credentialsMessage } from './share'
import WorkspaceDetailPage from './WorkspaceDetailPage'
import WorkspacesPage from './WorkspacesPage'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const apiError = (reason: string, code = 'functions/unauthenticated') => Object.assign(new FirebaseError(code, 'x'), { details: { reason } })
const NOW = Date.now()
const tenant = (over: Record<string, unknown> = {}) => ({
  tenantId: 'ten_aaaaaaaaaa', name: 'Acme Quarry', createdAt: NOW - 86_400_000, timezone: 'Asia/Colombo', adminName: 'Ada', adminEmail: 'ada@acme.test',
  userCount: 3, vehicleCount: 5, adminCount: 2, activeAdminCount: 2, adminSignedIn: true, ...over,
})
const detail = (admins: unknown[]) => ({ tenant: { tenantId: 'ten_aaaaaaaaaa', name: 'Acme Quarry', createdAt: NOW - 86_400_000, timezone: 'Asia/Colombo', userCount: 3, vehicleCount: 5 }, admins })
const admin = (uid: string, over: Record<string, unknown> = {}) => ({
  uid, name: `Admin ${uid}`, email: `${uid}@acme.test`, status: 'active', mustChangePassword: false, createdAt: NOW - 1000, lastSignInAt: NOW - 5000, ...over,
})
const creds = () => ({ tenantId: 'ten_aaaaaaaaaa', adminUid: 'u1', loginUrl: 'https://convoypass.com/login', tempPassword: PW })

let qc: QueryClient
const wrap = (ui: React.ReactElement, path = '/platform/workspaces') => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/platform/workspaces" element={ui} />
          <Route path="/platform/workspaces/:tenantId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const cacheText = () => JSON.stringify([qc.getQueryCache().getAll().map((q) => q.state.data), qc.getMutationCache().getAll()])

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear(); sessionStorage.clear()
  api.listTenants.mockResolvedValue({ tenants: [tenant(), tenant({ tenantId: 'ten_bbbbbbbbbb', name: 'Fresh Co', adminSignedIn: false, adminCount: 1, activeAdminCount: 1 })], nextCursor: null })
  api.createWorkspace.mockResolvedValue(creds())
  api.getWorkspace.mockResolvedValue(detail([admin('u1'), admin('u2', { lastSignInAt: null, mustChangePassword: true })]))
  api.resetTenantAdminCredential.mockResolvedValue(creds())
  api.addTenantAdmin.mockResolvedValue(creds())
  api.setTenantAdminStatus.mockResolvedValue({ ok: true })
  api.updateTenantAdmin.mockResolvedValue({ ok: true })
  reauth.mockResolvedValue(undefined)
})

describe('credentials message and card', () => {
  const view = { company: 'Smith & Sons #1', loginUrl: 'https://convoypass.com/login', email: 'ada+ops@acme.test', tempPassword: PW }
  it('the message has company, login URL, email, password and the notice', () => {
    const text = credentialsMessage({ company: view.company, loginUrl: view.loginUrl, email: view.email, password: PW })
    expect(text).toContain('Smith & Sons #1')
    expect(text).toContain(`Login: ${view.loginUrl}`)
    expect(text).toContain(`Email: ${view.email}`)
    expect(text).toContain(`Temporary password: ${PW}`)
    expect(text).toContain('You will be asked to choose a new password when you sign in. Please do not forward this message')
  })
  it('masks the password until Show, warns it is shown once, and encodes the WhatsApp and email links', () => {
    render(<CredentialsCard view={view} onConfirm={vi.fn()} />)
    const pw = screen.getByLabelText('Temporary password') as HTMLInputElement
    expect(pw.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: /Show: Temporary password/ }))
    expect(pw.type).toBe('text')
    expect(screen.getByText(/shown only once/)).toBeInTheDocument()

    const wa = screen.getByRole('link', { name: 'Send by WhatsApp' }) as HTMLAnchorElement
    expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true)
    const raw = wa.href.slice('https://wa.me/?text='.length)
    expect(raw).not.toMatch(/[\s#&]/)
    const text = new URL(wa.href).searchParams.get('text') ?? ''
    expect(text).toContain('Smith & Sons #1')
    expect(text).toContain(PW)
    const mail = screen.getByRole('link', { name: 'Send by email' }) as HTMLAnchorElement
    expect(mail.href.startsWith('mailto:ada%2Bops@acme.test?subject=')).toBe(true)
    expect(new URL(mail.href).searchParams.get('body')).toBe(text)
    expect(new URL(mail.href).searchParams.get('subject')).toBe('Your ConvoyPass login for Smith & Sons #1')
  })
  it('copies each value and the whole message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CredentialsCard view={view} onConfirm={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy: Temporary password' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PW))
    fireEvent.click(screen.getByRole('button', { name: 'Copy: Login URL' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(view.loginUrl))
    fireEvent.click(screen.getByRole('button', { name: 'Copy all as message' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Temporary password: ${PW}`)))
  })
  it('only the "I\'ve shared it" button dismisses it', () => {
    const onConfirm = vi.fn()
    render(<CredentialsCard view={view} onConfirm={onConfirm} />)
    expect(screen.queryByRole('button', { name: /close|cancel|dismiss/i })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: "I've shared it" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('Workspaces page', () => {
  it('lists workspaces with admin counts and a "Not signed in yet" chip only where no admin has signed in', async () => {
    wrap(<WorkspacesPage />)
    const acme = (await screen.findAllByText('Acme Quarry'))[0]!.closest('tr') as HTMLElement
    const fresh = screen.getAllByText('Fresh Co')[0]!.closest('tr') as HTMLElement
    expect(within(acme).queryByText('Not signed in yet')).toBeNull()
    expect(within(fresh).getByText('Not signed in yet')).toBeInTheDocument()
    expect(within(acme).getByRole('link', { name: 'Acme Quarry' })).toHaveAttribute('href', '/platform/workspaces/ten_aaaaaaaaaa')
    fireEvent.change(screen.getByLabelText('Search workspaces'), { target: { value: 'fresh' } })
    expect(screen.queryByText('Acme Quarry')).toBeNull()
  })
  it('creates a workspace, shows the one-time card, and clears the password after "I\'ve shared it"', async () => {
    wrap(<WorkspacesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: ' Acme Quarry ' } })
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: 'Ada Admin' } })
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'Ada@Acme.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    const pw = (await screen.findByLabelText('Temporary password')) as HTMLInputElement
    expect(pw.value).toBe(PW)
    expect(api.createWorkspace).toHaveBeenCalledWith({ companyName: 'Acme Quarry', timezone: 'Asia/Colombo', adminName: 'Ada Admin', adminEmail: 'ada@acme.test' })
    expect((screen.getByLabelText('Admin email') as HTMLInputElement).value).toBe('ada@acme.test')
    // the card is up: it cannot be replaced by another creation
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: "I've shared it" }))
    await waitFor(() => expect(screen.queryByLabelText('Temporary password')).toBeNull())
    expect(document.body.innerHTML).not.toContain(PW)
    expect(cacheText()).not.toContain(PW)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(PW)
  })
  it('clears the password when the page is left', async () => {
    const { unmount } = wrap(<WorkspacesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Quarry' } })
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: 'Ada Admin' } })
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'ada@acme.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await screen.findByLabelText('Temporary password')
    unmount()
    expect(document.body.innerHTML).not.toContain(PW)
    expect(cacheText()).not.toContain(PW)
  })
  it('validates the form (company, timezone from the list, name, email) before calling the server', async () => {
    wrap(<WorkspacesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Mars/Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    expect(await screen.findByText('Choose a timezone from the list.')).toBeInTheDocument()
    expect(screen.getByText('Use 2 to 80 characters.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(api.createWorkspace).not.toHaveBeenCalled()
  })
  it('on reauth-required asks for the password and retries the same request once', async () => {
    api.createWorkspace.mockRejectedValueOnce(apiError('reauth-required')).mockResolvedValueOnce(creds())
    wrap(<WorkspacesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Quarry' } })
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: 'Ada Admin' } })
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'ada@acme.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'my-password-123' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByLabelText('Temporary password')).toBeInTheDocument()
    expect(api.createWorkspace).toHaveBeenCalledTimes(2)
    expect(reauth).toHaveBeenCalledWith('my-password-123')
  })
})

describe('Workspace detail page', () => {
  const open = () => wrap(<WorkspaceDetailPage />, '/platform/workspaces/ten_aaaaaaaaaa')
  const row = async (name: string) => (await screen.findAllByText(name))[0]!.closest('tr') as HTMLElement

  it('shows the summary and counts only, the admins with first sign-in state, and links nowhere into tenant data', async () => {
    open()
    expect(await screen.findByRole('heading', { name: 'Acme Quarry' })).toBeInTheDocument()
    expect(screen.getByText(/Users \(counts only\)/)).toBeInTheDocument()
    expect(within(await row('Admin u1')).getByText('Signed in')).toBeInTheDocument()
    expect(within(await row('Admin u2')).getByText('Not signed in yet')).toBeInTheDocument()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/platform/workspaces'])
  })
  it('reset credentials issues a one-time card for that admin', async () => {
    open()
    fireEvent.click(within(await row('Admin u1')).getByRole('button', { name: 'Reset credentials: Admin u1' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset credentials' }))
    expect(((await screen.findByLabelText('Temporary password')) as HTMLInputElement).value).toBe(PW)
    expect(api.resetTenantAdminCredential).toHaveBeenCalledWith({ tenantId: 'ten_aaaaaaaaaa', uid: 'u1' })
    expect((screen.getByLabelText('Admin email') as HTMLInputElement).value).toBe('u1@acme.test')
    // other actions are locked until the card is confirmed
    expect(within(await row('Admin u2')).getByRole('button', { name: 'Disable: Admin u2' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: "I've shared it" }))
    await waitFor(() => expect(document.body.innerHTML).not.toContain(PW))
    expect(cacheText()).not.toContain(PW)
  })
  it('disabling the last active admin shows the server message and keeps the dialog open', async () => {
    api.setTenantAdminStatus.mockRejectedValueOnce(apiError('last-admin', 'functions/failed-precondition'))
    open()
    fireEvent.click(within(await row('Admin u1')).getByRole('button', { name: 'Disable: Admin u1' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }))
    expect(await within(dialog).findByText('A workspace must keep at least one active admin. Add another admin first.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('enable and disable send the right status; add admin shows a one-time card', async () => {
    api.getWorkspace.mockResolvedValue(detail([admin('u1'), admin('u2', { status: 'disabled' })]))
    open()
    fireEvent.click(within(await row('Admin u2')).getByRole('button', { name: 'Enable: Admin u2' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(api.setTenantAdminStatus).toHaveBeenCalledWith({ tenantId: 'ten_aaaaaaaaaa', uid: 'u2', status: 'active' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Add admin' }))
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: 'Cy Cee' } })
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: 'Cy@Acme.test' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add admin' }).at(-1)!)
    expect(await screen.findByLabelText('Temporary password')).toBeInTheDocument()
    expect(api.addTenantAdmin).toHaveBeenCalledWith({ tenantId: 'ten_aaaaaaaaaa', name: 'Cy Cee', email: 'cy@acme.test' })
  })
  it('edit name sends the new name only', async () => {
    open()
    fireEvent.click(within(await row('Admin u1')).getByRole('button', { name: 'Edit name: Admin u1' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateTenantAdmin).toHaveBeenCalledWith({ tenantId: 'ten_aaaaaaaaaa', uid: 'u1', name: 'Ada Lovelace' }))
  })
  it('shows a not-found state for an unknown workspace', async () => {
    api.getWorkspace.mockRejectedValue(apiError('workspace-not-found', 'functions/not-found'))
    open()
    expect(await screen.findByText('This workspace was not found.')).toBeInTheDocument()
  })
})
