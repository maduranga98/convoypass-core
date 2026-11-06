import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Counts are keyed by "collection" or "collection:role" so each test can say what the tenant already has.
let counts: Record<string, number> = {}
const asked: string[] = []
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
let tenantId = 'T1'
let role = 'admin'

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { role, tenantId } }) }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  query: (c: { name: string }, ...w: { field: string; value: unknown }[]) => ({ name: c.name, where: w }),
  getCountFromServer: async (q: { name: string; where: { field: string; value: unknown }[] }) => {
    const role = q.where.find((w) => w.field === 'role')?.value
    const tenant = q.where.find((w) => w.field === 'tenantId')?.value
    asked.push(`${q.name}${role ? `:${String(role)}` : ''}@${String(tenant)}`)
    return { data: () => ({ count: counts[role ? `${q.name}:${String(role)}` : q.name] ?? 0 }) }
  },
}))

import { OnboardingCard } from './OnboardingCard'
import { OnboardingGate } from './OnboardingGate'
import { dismissedKey, markSettingsVisited, settingsVisitedKey } from './storage'

const Where = () => {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const wrap = (node: React.ReactNode, path = '/admin/dashboard') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/dashboard" element={<>{node}<Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
)
const stepItem = (title: string) => screen.getByText(title).closest('li') as HTMLElement

beforeEach(() => {
  counts = {}
  asked.length = 0
  tenantId = 'T1'
  role = 'admin'
  localStorage.clear()
  vi.clearAllMocks()
})

describe('OnboardingCard', () => {
  it('lists the seven steps, all open for a brand new tenant, each with a link to the right screen', async () => {
    render(wrap(<OnboardingCard tenantId="T1" />))
    expect(await screen.findByRole('heading', { name: 'Get ConvoyPass ready' })).toBeInTheDocument()
    expect(screen.getByText('0 of 7 done')).toBeInTheDocument()
    const links: [string, string][] = [
      ['Add your first contractor', '/admin/contractors'],
      ['Add a supervisor for it', '/admin/users'],
      ['Add vehicles', '/admin/vehicles'],
      ['Add drivers', '/admin/drivers'],
      ['Add an officer', '/admin/users'],
      ['Add a security user', '/admin/users'],
      ['Review the pass checklist and gates', '/admin/settings'],
    ]
    for (const [title, href] of links) {
      const li = stepItem(title)
      expect(li).toHaveAttribute('data-done', 'false')
      expect(li.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    // vehicles also get the CSV import shortcut
    expect(screen.getByRole('link', { name: 'Import CSV' })).toHaveAttribute('href', '/admin/vehicles?import=1')
    // every count is tenant scoped
    expect(asked.every((a) => a.endsWith('@T1'))).toBe(true)
    expect(asked.sort()).toEqual(['contractors@T1', 'drivers@T1', 'users:officer@T1', 'users:security@T1', 'users:supervisor@T1', 'vehicles@T1'])
  })

  it('ticks steps from live data', async () => {
    counts = { contractors: 1, 'users:supervisor': 2, vehicles: 0, drivers: 5, 'users:officer': 0, 'users:security': 1 }
    render(wrap(<OnboardingCard tenantId="T1" />))
    await screen.findByText('4 of 7 done')
    expect(stepItem('Add your first contractor')).toHaveAttribute('data-done', 'true')
    expect(stepItem('Add a supervisor for it')).toHaveAttribute('data-done', 'true')
    expect(stepItem('Add vehicles')).toHaveAttribute('data-done', 'false')
    expect(stepItem('Add drivers')).toHaveAttribute('data-done', 'true')
    expect(stepItem('Add an officer')).toHaveAttribute('data-done', 'false')
    expect(stepItem('Add a security user')).toHaveAttribute('data-done', 'true')
    expect(stepItem('Review the pass checklist and gates')).toHaveAttribute('data-done', 'false')
  })

  it('counts the Settings step once the admin has visited Settings on this device (per tenant)', async () => {
    markSettingsVisited('T1')
    render(wrap(<OnboardingCard tenantId="T1" />))
    await screen.findByText('1 of 7 done')
    expect(stepItem('Review the pass checklist and gates')).toHaveAttribute('data-done', 'true')
    expect(localStorage.getItem(settingsVisitedKey('T1'))).toBe('1')
    expect(localStorage.getItem(settingsVisitedKey('T2'))).toBeNull()
  })

  it('disappears when every step is done', async () => {
    counts = { contractors: 1, 'users:supervisor': 1, vehicles: 1, drivers: 1, 'users:officer': 1, 'users:security': 1 }
    markSettingsVisited('T1')
    render(wrap(<OnboardingCard tenantId="T1" />))
    await waitFor(() => expect(asked).toHaveLength(6))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Get ConvoyPass ready' })).toBeNull())
  })

  it('dismisses per tenant: remembered for this tenant, not for another', async () => {
    const first = render(wrap(<OnboardingCard tenantId="T1" />))
    await screen.findByRole('heading', { name: 'Get ConvoyPass ready' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the setup checklist' }))
    expect(screen.queryByRole('heading', { name: 'Get ConvoyPass ready' })).toBeNull()
    expect(localStorage.getItem(dismissedKey('T1'))).toBe('1')
    first.unmount()

    render(wrap(<OnboardingCard tenantId="T1" />))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Get ConvoyPass ready' })).toBeNull())
    cleanupDom()
    render(wrap(<OnboardingCard tenantId="T2" />))
    expect(await screen.findByRole('heading', { name: 'Get ConvoyPass ready' })).toBeInTheDocument()
  })

  it('ends with a Print QR labels tip that is not a tracked step', async () => {
    render(wrap(<OnboardingCard tenantId="T1" />))
    await screen.findByText('0 of 7 done')
    expect(screen.getByText(/print their QR labels/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'QR labels' })).toHaveAttribute('href', '/admin/qr')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('stays quiet until the counts have loaded', () => {
    render(wrap(<OnboardingCard tenantId="T1" />))
    expect(screen.queryByRole('heading', { name: 'Get ConvoyPass ready' })).toBeNull()
  })
})

describe('OnboardingGate', () => {
  it('shows the welcome toast once for ?welcome=1 and removes the parameter', async () => {
    render(wrap(<OnboardingGate />, '/admin/dashboard?welcome=1'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Welcome to ConvoyPass. Your workspace is ready.'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/dashboard$/))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
  it('does nothing special without the parameter, and shows nothing to non-admins', async () => {
    render(wrap(<OnboardingGate />))
    await screen.findByRole('heading', { name: 'Get ConvoyPass ready' })
    expect(toast.success).not.toHaveBeenCalled()
    cleanupDom()
    role = 'officer'
    render(wrap(<OnboardingGate />))
    expect(screen.queryByRole('heading', { name: 'Get ConvoyPass ready' })).toBeNull()
  })
})

function cleanupDom() {
  document.body.innerHTML = ''
}
