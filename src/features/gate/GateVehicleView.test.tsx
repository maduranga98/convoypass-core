import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/lib/roles'

const TODAY = '20260310'
const VID = 'veh_ab12cd34ef'
const ts = (ms: number) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) })

const h = vi.hoisted(() => ({
  role: 'security' as string,
  pass: null as Record<string, unknown> | null,
  passError: null as string | null,
  vehicle: { id: 'veh_ab12cd34ef', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', contractorId: 'C1', status: 'active' } as Record<string, unknown> | null,
  driver: { id: 'drv1', name: 'Dan Driver', status: 'active', photoPath: null } as Record<string, unknown> | null,
  contractor: { id: 'C1', name: 'Lanka Haulage', status: 'active' } as Record<string, unknown> | null,
  checkIn: vi.fn(),
  feedback: vi.fn(),
}))

vi.mock('@/lib/firebase', () => ({}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ checkIn: (...a: unknown[]) => h.checkIn(...a), denyEntry: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({
  useSession: () => ({ uid: 'sec1', claims: { role: h.role, tenantId: 'T1', contractorId: null }, profile: { name: 'Sam Security' } }),
}))
vi.mock('@/features/passes/useToday', () => ({ useToday: () => TODAY, useNow: () => Date.now() }))
vi.mock('@/features/passes/usePass', () => ({
  usePass: (id: string | null) =>
    id === null ? { status: 'loading' }
    : h.passError ? { status: 'error', error: { code: h.passError } }
    : h.pass ? { status: 'ready', pass: h.pass } : { status: 'missing' },
}))
vi.mock('@/features/shared/queries', () => ({ useDriverPhotoUrl: () => ({ data: undefined, isError: false }) }))
vi.mock('./queries', () => {
  const q = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() })
  return { useVehicleDoc: () => q(h.vehicle), useDriverDoc: () => q(h.driver), useContractorDoc: () => q(h.contractor) }
})
vi.mock('./useGate', () => ({
  useGates: () => ({ gates: [{ id: 'main', name: 'Main Gate' }], gate: { id: 'main', name: 'Main Gate' }, setGate: vi.fn() }),
  useGateRuntime: () => undefined,
}))
vi.mock('./gateQueue', () => ({ useOfflineQueue: () => [], pendingPassIds: () => new Set(), enqueueGate: vi.fn() }))
vi.mock('./feedback', () => ({ feedback: (...a: unknown[]) => h.feedback(...a) }))
vi.mock('./VehicleMovements', () => ({ VehicleMovements: () => null }))

const { default: GateVehicleView } = await import('./GateVehicleView')

const approvedPass = (over: Record<string, unknown> = {}) => ({
  id: `${VID}_${TODAY}`, vehicleId: VID, dateKey: TODAY, status: 'officer_approved', attempt: 2, driverId: 'drv1', driverName: 'Dan Driver',
  plateNo: 'WP LJ-4821', supervisor: { uid: 's', name: 'Kasun', at: ts(Date.now() - 60_000) }, officer: { uid: 'o', name: 'Olivia', at: ts(Date.now() - 30_000) },
  ...over,
})

function view(role: Role = 'security') {
  h.role = role
  const client = new QueryClient()
  const ui = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GateVehicleView vehicleId={VID} readOnly={role !== 'security'} />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const r = render(ui())
  return { ...r, again: () => r.rerender(ui()) }
}

beforeEach(() => {
  h.pass = approvedPass()
  h.passError = null
  h.vehicle = { id: VID, plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', contractorId: 'C1', status: 'active' }
  h.driver = { id: 'drv1', name: 'Dan Driver', status: 'active', photoPath: null }
  h.contractor = { id: 'C1', name: 'Lanka Haulage', status: 'active' }
  h.checkIn.mockReset()
  h.feedback.mockReset()
})

describe('GateVehicleView', () => {
  it('approved: green banner, plate, driver, approvers, no-photo warning and a CHECK IN button', () => {
    view()
    expect(screen.getByRole('heading', { name: 'APPROVED' })).toBeInTheDocument()
    expect(screen.getByText('WP LJ-4821')).toBeInTheDocument()
    expect(screen.getByText('Dan Driver')).toBeInTheDocument()
    expect(screen.getByText('No photo on file')).toBeInTheDocument()
    expect(screen.getByText(/Supervisor: Kasun/)).toBeInTheDocument()
    expect(screen.getByText(/Officer: Olivia/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^let in/i })).toBeEnabled()
    expect(h.feedback).toHaveBeenCalledWith('ok', true)
  })

  it('read-only roles see the same view without any action', () => {
    for (const role of ['admin', 'officer', 'supervisor'] as const) {
      const { unmount } = view(role)
      expect(screen.getByRole('heading', { name: 'APPROVED' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^let in/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /deny entry|record denied entry/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /scan next/i })).toBeNull()
      expect(screen.getByText(/Read only/)).toBeInTheDocument()
      unmount()
    }
    expect(h.feedback).not.toHaveBeenCalled()
  })

  it('a non-approved result has no CHECK IN, only "Record denied entry" and "Scan next"', () => {
    h.pass = approvedPass({ status: 'supervisor_approved', officer: undefined })
    view()
    expect(screen.getByRole('heading', { name: 'NOT APPROVED' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for the officer to approve.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^let in/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Record denied entry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan next' })).toBeInTheDocument()
    expect(h.feedback).toHaveBeenCalledWith('blocked', true)
  })

  it('a suspended vehicle blocks an approved pass', () => {
    h.vehicle = { ...h.vehicle, status: 'suspended' }
    view()
    expect(screen.getByRole('heading', { name: 'NOT APPROVED' })).toBeInTheDocument()
    expect(screen.getByText('This vehicle is suspended.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^let in/i })).toBeNull()
  })

  it('flips to green by itself when the pass is approved while the guard is looking', () => {
    h.pass = approvedPass({ status: 'supervisor_approved', officer: undefined })
    const v = view()
    expect(screen.queryByRole('button', { name: /^let in/i })).toBeNull()
    h.pass = approvedPass()
    v.again()
    expect(screen.getByRole('heading', { name: 'APPROVED' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^let in/i })).toBeInTheDocument()
  })

  it('no pass today: a denied read of a missing pass is "no pass", any other read error is "could not load"', () => {
    h.pass = null
    h.passError = 'permission-denied'
    const v = view()
    expect(screen.getByText('No pass submitted for today.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record denied entry' })).toBeInTheDocument()
    h.passError = 'unavailable'
    v.again()
    expect(screen.getByText("Couldn't load this vehicle.")).toBeInTheDocument()
  })

  it('unknown QR: not found, only "Scan next"', () => {
    h.vehicle = null
    view()
    expect(screen.getAllByText(/Unknown QR code/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /record denied entry/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Scan next' })).toBeInTheDocument()
  })

  it('a double tap fires one request, with the attempt the guard saw and a UUID requestId', async () => {
    let resolve: (v: unknown) => void = () => undefined
    h.checkIn.mockReturnValue(new Promise((r) => (resolve = r)))
    view()
    const button = screen.getByRole('button', { name: /^let in/i })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(h.checkIn).toHaveBeenCalledTimes(1)
    expect(h.checkIn.mock.calls[0]?.[0]).toMatchObject({ passId: `${VID}_${TODAY}`, expectedAttempt: 2, gateId: 'main' })
    expect((h.checkIn.mock.calls[0]?.[0] as { requestId: string }).requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await act(async () => resolve({ passId: `${VID}_${TODAY}`, status: 'checked_in', at: Date.now() }))
    expect(screen.getByRole('heading', { name: 'LET IN' })).toBeInTheDocument()
  })

  it('already checked in shows who, when and where, in amber, without CHECK IN', () => {
    h.pass = approvedPass({ status: 'checked_in', checkIn: { uid: 'x', name: 'Nimal', at: ts(new Date(2026, 2, 10, 8, 14).getTime()), gateId: 'main', gateName: 'Main Gate', requestId: 'r' } })
    view()
    expect(screen.getByRole('heading', { name: 'ALREADY LET IN' })).toBeInTheDocument()
    expect(screen.getByText(/Let in at .*08:14.* by Nimal · Main Gate/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^let in/i })).toBeNull()
  })
})
