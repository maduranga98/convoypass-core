import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportRequest, ReportResult } from '@/types/reports'

const runReport = vi.fn(async (req: ReportRequest): Promise<ReportResult> => ({
  type: req.type,
  columns: [{ key: 'plate', label: 'Plate', type: 'text' }],
  rows: [{ plate: 'WP CAB 1234' }],
  summary: { tiles: [{ key: 'n', label: 'Check-ins', value: 1 }], sections: [] },
  generatedAt: Date.UTC(2026, 2, 10, 6, 0),
  timezone: 'Asia/Colombo',
  from: req.from,
  to: req.to,
}))
vi.mock('@/lib/api', () => ({ runReport: (r: ReportRequest) => runReport(r) }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'u', claims: { role: 'admin', tenantId: 'T1', contractorId: null }, profile: { name: 'N' } }) }))
vi.mock('@/features/passes/useToday', () => ({ useToday: () => '20260310' }))
vi.mock('@/features/shared/queries', () => ({
  useContractorList: () => ({ data: [{ id: 'C1', name: 'Alpha Haulage' }, { id: 'C2', name: 'Beta Transport' }] }),
  useVehicles: () => ({ data: { items: [{ id: 'veh_aaaaaaaaaa', plateNo: 'WP CAB 1234', type: 'Tipper' }] }, isPending: false }),
  useDrivers: () => ({ data: { items: [] }, isPending: false }),
}))

import ReportsPage from './ReportsPage'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <ReportsPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  runReport.mockClear()
})

describe('ReportsPage', () => {
  it('shows the picker and runs nothing until a report is chosen', () => {
    renderAt('/admin/reports')
    expect(screen.getAllByRole('button', { name: /Gate log|Contractor activity|Turnaround|Rejections|Vehicle history|Driver history/ })).toHaveLength(6)
    expect(runReport).not.toHaveBeenCalled()
  })

  it('runs ?type=gate_log for today straight away (the old gate log URL)', async () => {
    renderAt('/admin/reports?type=gate_log')
    expect(await screen.findByText('WP CAB 1234')).toBeInTheDocument()
    expect(runReport).toHaveBeenCalledWith({ type: 'gate_log', from: '2026-03-10', to: '2026-03-10' })
  })

  it('runs on Apply only, writes the filters to the URL, and the same URL gives the same request after a refresh', async () => {
    const first = renderAt('/admin/reports?type=contractor_activity')
    await screen.findByText('WP CAB 1234')
    runReport.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await userEvent.selectOptions(screen.getByLabelText('Contractor'), 'C2')
    expect(runReport).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/reports?type=contractor_activity')

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(1))
    const request = { type: 'contractor_activity', from: '2026-03-04', to: '2026-03-10', contractorId: 'C2' }
    expect(runReport).toHaveBeenLastCalledWith(request)
    const url = screen.getByTestId('where').textContent ?? ''
    expect(url).toContain('preset=last7')
    expect(url).toContain('contractor=C2')
    expect(url).toContain('from=2026-03-04')

    // A refresh: a brand new app on the same URL runs the same request and shows the same draft.
    first.unmount()
    runReport.mockClear()
    renderAt(url)
    await screen.findByText('WP CAB 1234')
    expect(runReport).toHaveBeenCalledWith(request)
    expect(screen.getByLabelText('Contractor')).toHaveValue('C2')
    expect(screen.getByLabelText('From')).toHaveValue('2026-03-04')
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a history report waits for a vehicle, and a range over 92 days cannot be applied', async () => {
    renderAt('/admin/reports?type=vehicle_history')
    expect(await screen.findByText('Choose a vehicle to run this report.', { selector: '[role=status]' })).toBeInTheDocument()
    expect(runReport).not.toHaveBeenCalled()

    await userEvent.type(screen.getByRole('combobox', { name: 'Vehicle' }), 'cab')
    await userEvent.click(await screen.findByRole('button', { name: /WP CAB 1234/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(runReport).toHaveBeenCalledWith({ type: 'vehicle_history', from: '2026-03-10', to: '2026-03-10', vehicleId: 'veh_aaaaaaaaaa' }))

    await userEvent.clear(screen.getByLabelText('From'))
    await userEvent.type(screen.getByLabelText('From'), '2025-01-01')
    expect(screen.getByRole('alert')).toHaveTextContent('at most 92 days')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
})
