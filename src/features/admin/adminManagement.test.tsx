// Module 10: tenant admins no longer manage admin accounts.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const users = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('@/lib/api', () => ({ createUser: vi.fn(), updateUser: vi.fn(), resetCredential: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'adminA', claims: { role: 'admin', tenantId: 'T1' }, profile: {} }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { name: 'Acme', timezone: 'Asia/Colombo' } }) }))
vi.mock('@/features/shared/queries', () => ({
  useDriverAccounts: () => ({ data: new Map(), isPending: false, isError: false }),
  useContractorList: () => ({ data: [{ id: 'c1', name: 'Haul Co', status: 'active' }], isPending: false, isError: false }),
}))
vi.mock('./queries', () => ({
  useUsers: () => ({ isPending: false, isError: false, data: users.data, refetch: vi.fn() }),
  useContractors: () => ({ isPending: false, isError: false, data: [{ id: 'c1', name: 'Haul Co', status: 'active' }] }),
}))

import { AdminsCard } from './AdminsCard'
import { CreateUserDrawer } from './CreateUserDrawer'
import UsersPage from './UsersPage'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const row = (id: string, role: string, name: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: 'T1', role, name, email: `${id}@x.test`, phone: null, contractorId: null, status: 'active', mustChangePassword: false, ...over,
})
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>

describe('Create user form', () => {
  it('has no Admin role (officer, supervisor, driver and security remain)', () => {
    render(wrap(<CreateUserDrawer open onClose={vi.fn()} />))
    const select = screen.getByLabelText('Role') as HTMLSelectElement
    const options = [...select.options].map((o) => o.text)
    expect(options).not.toContain('Admin')
    expect(options).toEqual(expect.arrayContaining(['Officer', 'Supervisor', 'Driver', 'Security']))
  })
})

describe('Users page', () => {
  it('admin rows show "Managed by ConvoyPass" and no edit, reset or disable action; other roles keep theirs', () => {
    users.data = [row('adminA', 'admin', 'Ada Admin'), row('admin2', 'admin', 'Bob Admin'), row('off1', 'officer', 'Olga Officer')]
    render(wrap(<UsersPage />))
    for (const name of ['Ada Admin', 'Bob Admin']) {
      const tr = screen.getAllByText(name).map((el) => el.closest('tr')).find(Boolean) as HTMLElement
      expect(within(tr).getByText('Managed by ConvoyPass')).toBeInTheDocument()
      expect(within(tr).queryAllByRole('button')).toHaveLength(0)
    }
    const officer = screen.getAllByText('Olga Officer').map((el) => el.closest('tr')).find(Boolean) as HTMLElement
    expect(within(officer).queryByText('Managed by ConvoyPass')).toBeNull()
    expect(within(officer).getAllByRole('button').length).toBeGreaterThanOrEqual(3)
  })
  it('shows the contact note', () => {
    users.data = [row('off1', 'officer', 'Olga Officer')]
    render(wrap(<UsersPage />))
    expect(screen.getByText('To add or reset an admin, contact your ConvoyPass administrator.')).toBeInTheDocument()
  })
})

describe('Settings: Admins card', () => {
  it('lists admin names, emails and status read only, with the contact note', () => {
    users.data = [row('adminA', 'admin', 'Ada Admin'), row('admin2', 'admin', 'Bob Admin', { status: 'disabled' })]
    render(wrap(<AdminsCard />))
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('admin2@x.test')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('To add or reset an admin, contact your ConvoyPass administrator.')).toBeInTheDocument()
  })
})
