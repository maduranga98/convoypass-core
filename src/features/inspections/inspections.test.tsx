import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vehicle, WithId } from '@/types'
import type { Inspection } from '@/types/inspections'

const ts = (ms: number) => ({ toMillis: () => ms }) as never
const WHEN = Date.UTC(2026, 2, 10, 6, 0, 0)

const recordInspection = vi.fn()
const withdrawClearance = vi.fn()
const checkEligibility = vi.fn()
let history: (Inspection & { id: string })[] = []
let vehicleList: WithId<Vehicle>[] = []

vi.mock('@/lib/api', () => ({
  recordInspection: (...a: unknown[]) => recordInspection(...a),
  withdrawClearance: (...a: unknown[]) => withdrawClearance(...a),
  checkEligibility: (...a: unknown[]) => checkEligibility(...a),
}))
vi.mock('@/features/gatePasses/GatePassSection', () => ({ GatePassSection: () => null }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { tenantId: 'T' } }) }))
vi.mock('@/features/penalties/queries', () => ({ useTenantTimezone: () => 'Asia/Colombo' }))
vi.mock('@/features/shared/queries', () => ({
  useVehicles: () => ({ data: { items: vehicleList, capped: false }, isPending: false, isError: false }),
  useDrivers: () => ({ data: { items: [{ id: 'd1', name: 'Dan Driver' }], capped: false }, isPending: false, isError: false }),
  useContractorList: () => ({ data: [{ id: 'C1', name: 'Acme Haulage' }], isPending: false, isError: false }),
}))
vi.mock('./queries', () => ({
  HISTORY_LIMIT: 50,
  useVehicleInspections: () => ({ data: history, isPending: false, isError: false }),
  useReinspectionVehicles: () => ({
    data: vehicleList.filter((v) => v.clearance && v.clearance.status !== 'cleared'),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

const vehicle = (id: string, plate: string, clearance?: Vehicle['clearance']): WithId<Vehicle> =>
  ({ id, tenantId: 'T', contractorId: 'C1', plateNo: plate, plateKey: plate.replace(/\W/g, ''), type: 'Tipper', assignedDriverIds: ['d1'], status: 'active', ...(clearance ? { clearance } : {}) }) as WithId<Vehicle>

const inspection = (over: Partial<Inspection> & { id: string }): Inspection & { id: string } =>
  ({
    tenantId: 'T', vehicleId: 'v1', contractorId: 'C1', plateNo: 'WP LJ-4821', inspectedBy: { uid: 'u', name: 'Sam Safety' }, inspectedAt: ts(WHEN), result: 'approved',
    notes: '', status: 'active', invalidatedReason: null, invalidatedAt: null, createdAt: ts(WHEN), ...over,
  }) as Inspection & { id: string }

const wrap = (ui: React.ReactNode, url = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  history = []
  vehicleList = []
  recordInspection.mockReset().mockResolvedValue({ inspectionId: 'x', created: true, clearance: 'cleared' })
  withdrawClearance.mockReset().mockResolvedValue({ ok: true })
  checkEligibility.mockReset().mockResolvedValue({ vehicle: { penalties: [], documentStatus: 'valid' }, driver: null })
})

describe('ClearanceBadge: word + icon, never colour alone', () => {
  it('shows a distinct word for each state and names the reason', async () => {
    const { ClearanceBadge } = await import('./ClearanceBadge')
    render(
      <>
        <ClearanceBadge clearance={{ status: 'cleared', reason: null }} />
        <ClearanceBadge clearance={{ status: 'needs_reinspection', reason: 'penalty_issued' }} showReason />
        <ClearanceBadge clearance={{ status: 'rejected', reason: null }} />
        <ClearanceBadge clearance={{ status: 'never_inspected', reason: null }} />
      </>,
    )
    expect(screen.getByText('Cleared')).toBeInTheDocument()
    expect(screen.getByText('Needs re-inspection')).toBeInTheDocument()
    expect(screen.getByText('A penalty was issued')).toBeInTheDocument()
    expect(screen.getByText('Inspection rejected')).toBeInTheDocument()
    expect(screen.getByText('Never inspected')).toBeInTheDocument()
  })
})

describe('InspectionHistory', () => {
  it('lists every inspection with officer, result, status and the cancellation reason', async () => {
    const { InspectionHistory } = await import('./InspectionHistory')
    history = [
      inspection({ id: 'a', status: 'invalidated', invalidatedReason: 'document_expired', invalidatedAt: ts(WHEN + 60_000), notes: 'Brakes fine' }),
      inspection({ id: 'b', status: 'superseded', result: 'rejected', notes: 'Tyres worn' }),
      inspection({ id: 'c', status: 'invalidated', invalidatedReason: 'manual', invalidatedAt: ts(WHEN), invalidationNote: 'Cracked windscreen' }),
    ]
    render(wrap(<InspectionHistory scope="admin" vehicleId="v1" />))
    expect(screen.getAllByText('Sam Safety', { exact: false })).toHaveLength(3)
    expect(screen.getByText(/Cancelled .*: A document expired/)).toBeInTheDocument()
    expect(screen.getByText(/Cancelled .*: Withdrawn by the Safety Officer/)).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Replaced')).toBeInTheDocument()
    expect(screen.getByText('Tyres worn')).toBeInTheDocument()
    expect(screen.getByText('Cracked windscreen')).toBeInTheDocument()
  })

  it('says so when a vehicle was never inspected', async () => {
    const { InspectionHistory } = await import('./InspectionHistory')
    render(wrap(<InspectionHistory scope="supervisor" vehicleId="v1" />))
    expect(screen.getByText('This vehicle has not been inspected yet.')).toBeInTheDocument()
  })
})

describe('Needs re-inspection list', () => {
  it('shows vehicles needing re-inspection with their reason, and rejected ones, but not cleared or never inspected', async () => {
    const { default: ReinspectionPage } = await import('./ReinspectionPage')
    vehicleList = [
      vehicle('v1', 'WP AA-1111', { status: 'needs_reinspection', inspectionId: 'i1', reason: 'penalty_issued', at: WHEN }),
      vehicle('v2', 'WP BB-2222', { status: 'rejected', inspectionId: 'i2', reason: null, at: WHEN }),
      vehicle('v3', 'WP CC-3333', { status: 'cleared', inspectionId: 'i3', reason: null, at: WHEN }),
      vehicle('v4', 'WP DD-4444'),
    ]
    render(wrap(<ReinspectionPage />))
    expect(screen.getAllByText('WP AA-1111').length).toBeGreaterThan(0)
    expect(screen.getAllByText('WP BB-2222').length).toBeGreaterThan(0)
    expect(screen.queryByText('WP CC-3333')).toBeNull()
    expect(screen.queryByText('WP DD-4444')).toBeNull()
    expect(screen.getAllByText('A penalty was issued').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rejected at the last inspection').length).toBeGreaterThan(0)
    expect(screen.getByText('2 vehicles need re-inspection')).toBeInTheDocument()
  })

  it('has an empty state when nothing needs re-checking', async () => {
    const { default: ReinspectionPage } = await import('./ReinspectionPage')
    render(wrap(<ReinspectionPage />))
    expect(screen.getByText('Nothing to re-check')).toBeInTheDocument()
  })
})

describe('Record inspection screen', () => {
  const open = async (url = '/') => {
    const { default: RecordInspectionPage } = await import('./RecordInspectionPage')
    render(wrap(<RecordInspectionPage />, url))
  }

  it('shows why an invalidated vehicle needs re-inspection and what to check first', async () => {
    vehicleList = [vehicle('v1', 'WP LJ-4821', { status: 'needs_reinspection', inspectionId: 'i1', reason: 'penalty_issued', at: WHEN })]
    checkEligibility.mockImplementation(async (ref: { vehicleId?: string }) =>
      ref.vehicleId
        ? { vehicle: { penalties: [{ id: 'pen1', typeName: 'Safety Violation', permanent: true, endDate: null }], documentStatus: 'valid' }, driver: null }
        : { vehicle: null, driver: { penalties: [], documentStatus: 'expired' } },
    )
    await open('/?vehicle=v1')
    const current = screen.getByRole('region', { name: 'Current clearance' })
    expect(within(current).getByText('Needs re-inspection')).toBeInTheDocument()
    expect(screen.getByText(/A penalty was issued against this vehicle or one of its drivers/)).toBeInTheDocument()
    expect(await screen.findByText('Active penalty: Safety Violation (no end date)')).toBeInTheDocument()
    expect(screen.getByText('Dan Driver: driver licence has expired.')).toBeInTheDocument()
  })

  it('approves: sends the id, vehicle, result and trimmed notes, then resets', async () => {
    const user = userEvent.setup()
    vehicleList = [vehicle('v1', 'WP LJ-4821')]
    await open()
    await user.click(screen.getByRole('radio', { name: /WP LJ-4821/ }))
    expect(screen.getByText('Never inspected')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Notes/), '  Lights and brakes fine  ')
    await user.click(screen.getByRole('button', { name: 'Approve vehicle' }))
    await waitFor(() => expect(recordInspection).toHaveBeenCalledTimes(1))
    expect(recordInspection).toHaveBeenCalledWith({ inspectionId: expect.stringMatching(/^insp_[a-z0-9]{10}$/), vehicleId: 'v1', result: 'approved', notes: 'Lights and brakes fine' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve vehicle' })).toBeNull())
  })

  it('a rejection needs a note, and the button changes to say so', async () => {
    const user = userEvent.setup()
    vehicleList = [vehicle('v1', 'WP LJ-4821')]
    await open('/?vehicle=v1')
    await user.click(screen.getByRole('radio', { name: 'Reject' }))
    await user.click(screen.getByRole('button', { name: 'Reject vehicle' }))
    expect(await screen.findByText('Say what was wrong')).toBeInTheDocument()
    expect(recordInspection).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Notes/), 'Tyres worn')
    await user.click(screen.getByRole('button', { name: 'Reject vehicle' }))
    await waitFor(() => expect(recordInspection).toHaveBeenCalledWith(expect.objectContaining({ result: 'rejected', notes: 'Tyres worn' })))
  })

  it('a retry of the same decision reuses the id; changing anything gets a new one', async () => {
    const user = userEvent.setup()
    vehicleList = [vehicle('v1', 'WP LJ-4821')]
    recordInspection.mockRejectedValueOnce(new Error('offline'))
    await open('/?vehicle=v1')
    await user.click(screen.getByRole('button', { name: 'Approve vehicle' }))
    await waitFor(() => expect(recordInspection).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('button', { name: 'Approve vehicle' }))
    await waitFor(() => expect(recordInspection).toHaveBeenCalledTimes(2))
    const [first, second] = recordInspection.mock.calls.map((c) => (c[0] as { inspectionId: string }).inspectionId)
    expect(first).toBe(second)
  })

  it('offers to withdraw only a standing clearance, and asks for a reason', async () => {
    const user = userEvent.setup()
    vehicleList = [vehicle('v1', 'WP LJ-4821', { status: 'cleared', inspectionId: 'i1', reason: null, at: WHEN })]
    await open('/?vehicle=v1')
    await user.click(screen.getByRole('button', { name: 'Withdraw clearance' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Withdraw' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Cracked windscreen')
    await user.click(confirm)
    await waitFor(() => expect(withdrawClearance).toHaveBeenCalledWith({ vehicleId: 'v1', note: 'Cracked windscreen' }))
  })

  it('has no withdraw action for a vehicle that is not cleared', async () => {
    vehicleList = [vehicle('v1', 'WP LJ-4821', { status: 'needs_reinspection', inspectionId: 'i1', reason: 'manual', at: WHEN })]
    await open('/?vehicle=v1')
    expect(screen.queryByRole('button', { name: 'Withdraw clearance' })).toBeNull()
  })
})
