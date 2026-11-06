import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const record = vi.hoisted(() => vi.fn())
const drivers = vi.hoisted(() => ({ items: [] as unknown[], result: null as unknown }))
const contractors = vi.hoisted(() => ({ isPending: false, isError: false, data: [{ id: 'C1', name: 'Acme Haulage' }] }))
vi.mock('@/lib/api', () => ({ recordQualification: record }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'off1', claims: { role: 'officer', tenantId: 'T1', contractorId: null } }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ isPending: false, data: { timezone: 'Asia/Colombo' } }) }))
vi.mock('@/features/shared/documents', () => ({ useTenantDocuments: () => ({ today: '2026-10-27' }) }))
vi.mock('@/features/shared/queries', () => ({
  // Stable results, like TanStack Query's: a new object per render would re-run the memoised lists forever.
  useDrivers: () => drivers.result,
  useContractorList: () => contractors,
}))

import QualificationsPage from './QualificationsPage'

const rec = (completedOn: string, expiresOn: string) => ({ completedOn, expiresOn, recordedByUid: 'a', recordedByName: 'Ada', recordedAt: 1 })

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.clearAllMocks()
  record.mockResolvedValue({ expiresOn: '2027-10-27' })
  drivers.items = [
    { id: 'd1', name: 'Nimal', contractorId: 'C1', status: 'active', qualifications: { safety: rec('2026-01-01', '2027-01-01'), defensive_driving: rec('2025-01-01', '2026-01-01') } },
    { id: 'd2', name: 'Kamal', contractorId: 'C1', status: 'active', qualifications: { safety: rec('2026-10-01', '2027-10-01'), defensive_driving: rec('2026-10-01', '2027-10-01'), work_instruction: rec('2026-10-01', '2027-10-01') } },
    { id: 'd3', name: 'Off duty', contractorId: 'C1', status: 'disabled' },
  ]
  drivers.result = { isPending: false, isError: false, data: { items: drivers.items, capped: false } }
})

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <QualificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('QualificationsPage', () => {
  it('lists active drivers who still need something first, with a word for every status', () => {
    renderPage()
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('p.font-medium.text-ink'))
    expect(items.map((li) => within(li).getByText(/Nimal|Kamal/).textContent)).toEqual(['Nimal', 'Kamal'])
    expect(screen.queryByText('Off duty')).not.toBeInTheDocument()
    expect(screen.getByText('2 to fix')).toBeInTheDocument()
    expect(screen.getByText('All valid')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('records a completion date (not in the future) and sends the type and driver', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^Record: Work instruction, Nimal/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Date completed')).toHaveValue('2026-10-27')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(record).toHaveBeenCalledWith({ driverId: 'd1', typeId: 'work_instruction', completedOn: '2026-10-27' }))
  })
})
