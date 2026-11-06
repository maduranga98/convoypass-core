import 'fake-indexeddb/auto'
import { FirebaseError } from 'firebase/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WithId } from '@/types'
import type { DailySummary, Visit } from '@/types/visits'

const ts = (ms: number) => ({ toMillis: () => ms }) as never
const WHEN = Date.UTC(2026, 2, 10, 6, 0, 0)

const checkOutVisit = vi.fn()
const logUnloadingCheck = vi.fn()
let active: WithId<Visit>[] = []
let summary: DailySummary | undefined
let role = 'security'
let uid = 'u1'
let n = 0

vi.mock('@/lib/api', () => ({
  checkOutVisit: (...a: unknown[]) => checkOutVisit(...a),
  logUnloadingCheck: (...a: unknown[]) => logUnloadingCheck(...a),
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'T', plateNo: 'WP LJ-4821' }) }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid, claims: { tenantId: 'T', role }, profile: { name: 'Pat' } }) }))
vi.mock('@/features/gate/useGate', () => ({ useGates: () => ({ gates: [{ id: 'main', name: 'Main Gate' }], gate: { id: 'main', name: 'Main Gate' }, setGate: vi.fn() }) }))
vi.mock('@/features/passes/useOnline', () => ({ useOnline: () => true }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => WHEN + 90 * 60_000 }))
vi.mock('@/features/scan/QrScanner', () => ({
  QrScanner: ({ onVehicle }: { onVehicle: (id: string) => void }) => (
    <button type="button" onClick={() => onVehicle('veh_aaaaaaaaaa')}>fake scan</button>
  ),
}))
vi.mock('./queries', () => ({
  useActiveVisits: () => ({ items: active, status: 'ready', error: null, retry: vi.fn() }),
  useDailySummary: () => ({ data: summary, isError: false, isPending: summary === undefined, refetch: vi.fn() }),
}))

const visit = (id: string, plate: string, over: Partial<Visit> = {}): WithId<Visit> =>
  ({
    id, tenantId: 'T', vehicleId: 'veh_aaaaaaaaaa', driverId: 'd1', contractorId: 'C1', plateNo: plate, driverName: 'Dan Driver',
    checkIn: { timestamp: ts(WHEN), dateKey: '20260310', securityUserId: 's', securityUserName: 'Gate Guard', gateId: 'main', gateLocation: 'Main Gate', requestId: 'r' },
    unloadingCheck: null, checkOut: null, status: 'checked_in', driverOnDutyLock: true, dwellWarning: false, ...over,
  }) as WithId<Visit>

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  active = []
  summary = undefined
  role = 'security'
  uid = `u${++n}` // a fresh offline queue per test
  vi.stubGlobal('navigator', { onLine: true })
  checkOutVisit.mockReset().mockResolvedValue({ visitId: 'vis_a', at: WHEN, unloadingMissing: false })
  logUnloadingCheck.mockReset().mockResolvedValue({ visitId: 'vis_a', at: WHEN })
})

describe('check-out (security)', () => {
  it('lists vehicles on site, longest first, with the unloading state and a long-stay flag', async () => {
    active = [
      visit('vis_a', 'WP LJ-4821', { dwellWarning: true }),
      visit('vis_b', 'CAB-1', { unloadingCheck: { performed: true, timestamp: ts(WHEN), dateKey: '20260310', officerUserId: 'y', officerName: 'Yard', unloaded: true, unloadLocation: 'Bay 3' } }),
    ]
    const { default: CheckOutPage } = await import('./CheckOutPage')
    render(wrap(<CheckOutPage />))
    expect(await screen.findByText('2 on site')).toBeInTheDocument()
    expect(screen.getByText('Long stay')).toBeInTheDocument()
    expect(screen.getByText('Unloaded')).toBeInTheDocument()
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
    expect(screen.getAllByText(/1 h 30 min on site/).length).toBe(2)
  })

  it('confirm sends one request, warns when unloading was not checked, and never blocks', async () => {
    active = [visit('vis_a', 'WP LJ-4821')]
    checkOutVisit.mockResolvedValue({ visitId: 'vis_a', at: WHEN, unloadingMissing: true })
    const { default: CheckOutPage } = await import('./CheckOutPage')
    const user = userEvent.setup()
    render(wrap(<CheckOutPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Unloading has not been checked yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(checkOutVisit).toHaveBeenCalledTimes(1))
    expect(checkOutVisit).toHaveBeenCalledWith({ visitId: 'vis_a', requestId: expect.any(String) })
    expect(await screen.findByText('WP LJ-4821 checked out')).toBeInTheDocument()
    expect(screen.getByText('Unloading was not checked for this visit.')).toBeInTheDocument()
  })

  it('a scanned vehicle that is not checked in says so', async () => {
    const { default: CheckOutPage } = await import('./CheckOutPage')
    const user = userEvent.setup()
    render(wrap(<CheckOutPage />))
    await user.click(await screen.findByRole('button', { name: 'Scan vehicle' }))
    await user.click(await screen.findByRole('button', { name: 'fake scan' }))
    expect(await screen.findByText('This vehicle is not checked in.')).toBeInTheDocument()
  })
})

describe('unloading check (Yard Officer)', () => {
  beforeEach(() => {
    role = 'yard'
    active = [visit('vis_a', 'WP LJ-4821'), visit('vis_b', 'CAB-1', { unloadingCheck: { performed: true, timestamp: ts(WHEN), dateKey: '20260310', officerUserId: 'y', officerName: 'Yard', unloaded: true, unloadLocation: 'Bay 3' } })]
  })

  it('"yes" needs a place; save sends only the unloading fields', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /Yes, unloaded/ }))
    expect(save).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Bay 3' })).toBeInTheDocument() // a recent place
    await user.type(within(dialog).getByLabelText('Where was it unloaded?'), 'Bay 5')
    await user.click(save)
    await waitFor(() => expect(logUnloadingCheck).toHaveBeenCalledWith({ visitId: 'vis_a', unloaded: true, unloadLocation: 'Bay 5' }))
  })

  it('"no" saves without a place', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
    expect(within(dialog).queryByLabelText('Where was it unloaded?')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(logUnloadingCheck).toHaveBeenCalledWith({ visitId: 'vis_a', unloaded: false }))
  })

  it('starts from what was already logged, so it can be corrected', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /CAB-1/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Yes, unloaded/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByLabelText('Where was it unloaded?')).toHaveValue('Bay 3')
  })
})

describe('daily summary', () => {
  const base: DailySummary = { dateKey: '20260310', generatedAt: WHEN, dwellLimitHours: 16, tiles: {}, dwell: [] }

  it('shows exactly the tiles the server returned for the role', async () => {
    role = 'yard'
    summary = { ...base, tiles: { unloads: 3, awaitingUnload: 2, onSite: 5, dwellWarnings: 0 } }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage backTo="/yard" />))
    expect(await screen.findByText('Unloading checks')).toBeInTheDocument()
    expect(screen.getByText('Waiting for unloading check')).toBeInTheDocument()
    expect(screen.queryByText('Suspensions issued')).not.toBeInTheDocument()
    expect(screen.queryByText('Checked in')).not.toBeInTheDocument()
    expect(screen.getByText('No long stays.')).toBeInTheDocument()
  })

  it('raises a visible warning for long stays, links admins to the visit, and says nothing is blocked', async () => {
    role = 'admin'
    summary = { ...base, tiles: { checkIns: 4, dwellWarnings: 1 }, dwell: [{ visitId: 'vis_a', plateNo: 'WP LJ-4821', driverName: 'Dan Driver', checkInAt: WHEN, hours: 17 }] }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage />))
    expect(await screen.findByText('Warning only. Nothing is blocked.')).toBeInTheDocument()
    expect(screen.getAllByText('On site for 16 hours or more').length).toBeGreaterThan(0)
    expect(screen.getByText('17 h on site')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /WP LJ-4821/ })).toHaveAttribute('href', '/admin/visits/vis_a')
  })

  it('security sees the alert but gets no link to the full timeline', async () => {
    role = 'security'
    summary = { ...base, tiles: { checkIns: 4, dwellWarnings: 1 }, dwell: [{ visitId: 'vis_a', plateNo: 'WP LJ-4821', driverName: 'Dan Driver', checkInAt: WHEN, hours: 17 }] }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage backTo="/security" />))
    expect(await screen.findByText('17 h on site')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /WP LJ-4821/ })).not.toBeInTheDocument()
  })
})

describe('visit timeline', () => {
  it('shows who did each stage and what is still to do', async () => {
    const { VisitTimeline } = await import('./VisitTimeline')
    const done = visit('vis_a', 'WP LJ-4821', {
      unloadingCheck: { performed: true, timestamp: ts(WHEN + 3_600_000), dateKey: '20260310', officerUserId: 'y', officerName: 'Yara Yard', unloaded: true, unloadLocation: 'Bay 3' },
    })
    const { rerender } = render(<VisitTimeline visit={done} />)
    expect(screen.getByText('by Gate Guard')).toBeInTheDocument()
    expect(screen.getByText('by Yara Yard')).toBeInTheDocument()
    expect(screen.getByText('Unloaded · Place: Bay 3')).toBeInTheDocument()
    expect(screen.getByText('Still on site')).toBeInTheDocument()
    rerender(<VisitTimeline visit={visit('vis_b', 'CAB-1')} />)
    expect(screen.getAllByText('Not done yet').length).toBe(2) // unloading and check-out
    rerender(
      <VisitTimeline visit={{ ...done, status: 'checked_out', checkOut: { timestamp: ts(WHEN + 7_200_000), dateKey: '20260310', securityUserId: 's2', securityUserName: 'Night Guard', requestId: 'r2' } }} />,
    )
    expect(screen.getByText('by Night Guard')).toBeInTheDocument()
    expect(screen.queryByText('Still on site')).not.toBeInTheDocument()
  })

  describe('offline queue (Yard Officer)', () => {
    beforeEach(() => {
      role = 'yard'
      active = [visit('vis_a', 'WP LJ-4821')]
    })
    const open = async (plate: RegExp) => {
      const { default: UnloadingPage } = await import('./UnloadingPage')
      const user = userEvent.setup()
      render(wrap(<UnloadingPage />))
      await user.click(await screen.findByRole('button', { name: plate }))
      return { user, dialog: await screen.findByRole('dialog') }
    }
    const queueOf = async () => (await import('@/features/gate/gateQueue')).queueFor(uid).list()

    it('offline: the answer is queued, not sent, and the list shows Pending sync', async () => {
      vi.stubGlobal('navigator', { onLine: false })
      const { user, dialog } = await open(/WP LJ-4821/)
      await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(async () => expect(await queueOf()).toHaveLength(1))
      expect(logUnloadingCheck).not.toHaveBeenCalled()
      expect((await queueOf())[0]).toMatchObject({ type: 'logUnloading', status: 'waiting', plateNo: 'WP LJ-4821', payload: { visitId: 'vis_a', unloaded: false } })
      expect(await screen.findByText(/1 unloading check is saved on this phone/)).toBeInTheDocument()
      expect(screen.getAllByText('Pending sync').length).toBeGreaterThan(0)
    })

    it('a changed answer before it syncs replaces the waiting one', async () => {
      vi.stubGlobal('navigator', { onLine: false })
      const { user, dialog: first } = await open(/WP LJ-4821/)
      let dialog = first
      await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(async () => expect(await queueOf()).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: /WP LJ-4821/ }))
      dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /Yes, unloaded/ }))
      await user.type(within(dialog).getByLabelText('Where was it unloaded?'), 'Bay 5')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(async () => expect((await queueOf())[0]?.payload).toEqual({ visitId: 'vis_a', unloaded: true, unloadLocation: 'Bay 5' }))
      expect(await queueOf()).toHaveLength(1)
    })

    it('a network failure while online queues it too', async () => {
      logUnloadingCheck.mockRejectedValue(new FirebaseError('functions/internal', 'internal'))
      const { user, dialog } = await open(/WP LJ-4821/)
      await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(async () => expect(await queueOf()).toHaveLength(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('a typed refusal is an error banner and nothing is queued', async () => {
      logUnloadingCheck.mockRejectedValue(Object.assign(new FirebaseError('functions/failed-precondition', 'no'), { details: { reason: 'visit-not-found' } }))
      const { user, dialog } = await open(/WP LJ-4821/)
      await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
      expect(await queueOf()).toEqual([])
    })
  })
})
