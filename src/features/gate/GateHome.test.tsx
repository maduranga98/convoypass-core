// Module 12: the security home is one giant scan button, the plate search right under it, and two plain tabs.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'sec', claims: { role: 'security', tenantId: 'T1' } }) }))
vi.mock('@/features/passes/useOnline', () => ({ useOnline: () => true }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => 0, useToday: () => '20261008' }))
vi.mock('@/features/shared/queries', () => ({
  useVehicles: () => ({ data: { items: [], capped: false }, isPending: false }),
  useContractorList: () => ({ data: [] }),
}))
vi.mock('./gateQueue', () => ({ useOfflineQueue: () => [], pendingPassIds: () => new Set() }))
vi.mock('./queries', () => ({
  usePlatePrefixSearch: () => ({ data: [] }),
  usePrefetchPassPeople: () => undefined,
  useTodayGatePasses: () => ({ items: [], status: 'ready', cacheSince: null, lastSyncedAt: null, capped: false, retry: vi.fn() }),
}))
vi.mock('@/features/scan/QrScanner', () => ({ QrScanner: () => null }))
vi.mock('@/features/visitors/VisitorGate', () => ({ default: () => <p>visitor mode</p> }))

import GateHome from './GateHome'

describe('GateHome', () => {
  it('has one scan button, the plate search directly under it, and tabs "Waiting at gate" / "Let in today"', () => {
    render(<MemoryRouter><GateHome /></MemoryRouter>)
    const scan = screen.getByRole('button', { name: 'Scan vehicle QR' })
    const search = screen.getByLabelText('Search by plate')
    expect(scan.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /scan/i })).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /Waiting at gate/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Let in today/ })).toBeInTheDocument()
  })

  it('has a Vehicle / Visitor toggle: vehicle is the default, and the mode lives in the address', async () => {
    render(<MemoryRouter initialEntries={['/security']}><GateHome /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Vehicle' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Visitor' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Visitor' }))
    expect(await screen.findByText('visitor mode')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search by plate')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Vehicle' }))
    expect(screen.getByLabelText('Search by plate')).toBeInTheDocument()
  })

  it('opens straight in visitor mode from ?mode=visitor', async () => {
    render(<MemoryRouter initialEntries={['/security?mode=visitor']}><GateHome /></MemoryRouter>)
    expect(await screen.findByText('visitor mode')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visitor' })).toHaveAttribute('aria-pressed', 'true')
  })
})
