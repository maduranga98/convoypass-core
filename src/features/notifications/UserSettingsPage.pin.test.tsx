// Module 12: drivers and security see only name, role, company and Sign out on /settings.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('./push/registration', () => ({ disablePush: vi.fn(), enablePush: vi.fn(), isPushEnabledHere: () => false }))
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({
  useSession: () => ({ uid: 'sec', claims: { role: 'security', tenantId: 'T1', contractorId: null }, profile: { name: 'Sam Guard' } }),
  useAuth: () => ({ signOut }),
}))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { name: 'Acme Cement' }, isLoading: false }) }))

import UserSettingsPage from './UserSettingsPage'

describe('Settings for PIN roles', () => {
  it('shows name, role and company and a Sign out button; no PIN, password or alert controls', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><UserSettingsPage /></MemoryRouter>
      </QueryClientProvider>,
    )
    for (const text of ['Sam Guard', 'Security', 'Acme Cement']) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByText(/PIN|password/i)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})
