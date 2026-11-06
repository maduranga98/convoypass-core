import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WithId } from '@/types'
import type { GatePass, QualificationEntry, QualificationMeta } from '@/types/gatePasses'

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as never
const WHEN = Date.UTC(2026, 10, 10, 6, 0, 0)

const issueGatePasses = vi.fn()
const reactivateGatePass = vi.fn()
const blockGatePass = vi.fn()
const refreshQualificationList = vi.fn()
const updateTenantSettings = vi.fn()
const checkEligibility = vi.fn()
let passes: WithId<GatePass>[] = []
let entries: WithId<QualificationEntry>[] = []
let meta: QualificationMeta | null = null
let autoIssue = false

vi.mock('@/lib/api', () => ({
  issueGatePasses: (...a: unknown[]) => issueGatePasses(...a),
  reactivateGatePass: (...a: unknown[]) => reactivateGatePass(...a),
  blockGatePass: (...a: unknown[]) => blockGatePass(...a),
  refreshQualificationList: (...a: unknown[]) => refreshQualificationList(...a),
  updateTenantSettings: (...a: unknown[]) => updateTenantSettings(...a),
  checkEligibility: (...a: unknown[]) => checkEligibility(...a),
}))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { tenantId: 'T' } }) }))
vi.mock('@/features/penalties/queries', () => ({ useTenantTimezone: () => 'Asia/Colombo' }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { autoIssueGatePasses: autoIssue }, isPending: false }) }))
const contractorRows = [{ id: 'C1', name: 'Acme Haulage' }]
const vehicleRows = [
  { id: 'v1', plateNo: 'WP LJ-4821', status: 'active', assignedDriverIds: ['d1', 'd2'] },
  { id: 'v2', plateNo: 'WP SUSP-1', status: 'suspended', assignedDriverIds: ['d1'] },
]
const driverRows = [
  { id: 'd1', name: 'Dan Driver', status: 'active' },
  { id: 'd2', name: 'Gone Driver', status: 'disabled' },
]
vi.mock('@/features/shared/queries', () => ({
  useContractorList: () => ({ data: contractorRows, isPending: false, isError: false }),
  useVehicles: () => ({ data: { items: vehicleRows }, isPending: false, isError: false }),
  useDrivers: () => ({ data: { items: driverRows }, isPending: false, isError: false }),
}))
vi.mock('./model', async (orig) => ({ ...(await orig<typeof import('./model')>()), currentMonthKey: () => '2026-11' }))
vi.mock('./queries', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const api = await import('@/lib/api')
  return {
    MAX_PASSES: 1000,
    useGatePasses: () => ({ data: passes, isPending: false, isError: false, refetch: vi.fn() }),
    useGatePassesOf: () => ({ data: passes, isPending: false, isError: false }),
    useQualification: () => ({ data: { meta, entries }, isPending: false, isError: false, refetch: vi.fn() }),
    useReactivationCheck: (v: string, d: string) => ({ data: eligibility(v, d), isPending: false, isError: false }),
    useGatePassMutations: () => ({
      issue: useMutation({ mutationFn: (p: Parameters<typeof api.issueGatePasses>[0]) => api.issueGatePasses(p) }),
      block: useMutation({ mutationFn: (p: Parameters<typeof api.blockGatePass>[0]) => api.blockGatePass(p) }),
      reactivate: useMutation({ mutationFn: (passId: string) => api.reactivateGatePass({ passId }) }),
      refreshList: useMutation({ mutationFn: (m: string) => api.refreshQualificationList({ month: m }) }),
      setAutoIssue: useMutation({ mutationFn: (enabled: boolean) => api.updateTenantSettings({ autoIssueGatePasses: enabled }) }),
    }),
  }
})

const fixed = new Set<string>()
const eligibility = (v: string, d: string) => ({
  eligible: fixed.has(`${v}_${d}`),
  vehicle: { id: v, documentStatus: 'valid', blocked: !fixed.has(`${v}_${d}`), penalties: [] },
  driver: null,
  inspection: { status: 'cleared', cleared: true, reason: null, at: 1 },
})

const pass = (over: Partial<GatePass> & { id: string }): WithId<GatePass> =>
  ({
    tenantId: 'T', vehicleId: 'v1', driverId: 'd1', contractorId: 'C1', plateNo: 'WP LJ-4821', driverName: 'Dan Driver', month: '2026-11', status: 'active',
    issuedAt: ts(WHEN), issuedBy: { uid: 'a', name: 'Ada Admin' }, issueMode: 'manual', blockedReason: null, blockedAt: null, blockNote: null, reactivation: null, expiredAt: null, ...over,
  }) as WithId<GatePass>

const entry = (vehicleId: string, driverId: string, plate: string, driver: string): WithId<QualificationEntry> =>
  ({ id: `${vehicleId}_${driverId}`, tenantId: 'T', month: '2026-12', vehicleId, driverId, contractorId: 'C1', contractorName: 'Acme Haulage', plateNo: plate, driverName: driver, documentStatus: 'valid', computedAt: ts(WHEN) }) as WithId<QualificationEntry>

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  passes = []
  entries = []
  meta = null
  autoIssue = false
  fixed.clear()
  issueGatePasses.mockReset().mockResolvedValue({ issued: 0, results: [] })
  reactivateGatePass.mockReset().mockResolvedValue({ ok: true })
  blockGatePass.mockReset().mockResolvedValue({ ok: true })
  refreshQualificationList.mockReset().mockResolvedValue({})
  updateTenantSettings.mockReset().mockResolvedValue({ ok: true })
  checkEligibility.mockReset()
})

describe('GatePassBadge: word + icon, never colour alone', () => {
  it('shows a distinct word per state and the reason of a block', async () => {
    const { GatePassBadge } = await import('./GatePassBadge')
    render(
      <>
        <GatePassBadge status="active" />
        <GatePassBadge status="blocked" reason="penalty" showReason />
        <GatePassBadge status="expired" />
        <GatePassBadge status="not_issued" />
        <GatePassBadge status="blocked" reason="document_expired" showReason prefix />
      </>,
    )
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Penalty issued')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Not issued')).toBeInTheDocument()
    expect(screen.getByText('Gate Pass: Blocked (Document expired)')).toBeInTheDocument()
  })
})

describe('GatePassesPage (Company Admin overview)', () => {
  it('lists the month’s passes, filters by status and shows why a pass is blocked', async () => {
    passes = [
      pass({ id: 'a', plateNo: 'WP A-1' }),
      pass({ id: 'b', plateNo: 'WP B-2', status: 'blocked', blockedReason: 'penalty', blockedAt: ts(WHEN) }),
      pass({ id: 'c', plateNo: 'WP C-3', status: 'blocked', blockedReason: 'manual', blockNote: 'Speeding on site', blockedAt: ts(WHEN), vehicleId: 'v3' }),
    ]
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    expect(screen.getAllByText(/WP [ABC]-\d/)).toHaveLength(6) // table + mobile cards
    expect(screen.getAllByText('Penalty issued').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Speeding on site').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /^Active 1$/ }))
    expect(screen.queryAllByText('WP B-2')).toHaveLength(0)
    expect(screen.getAllByText('WP A-1').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /^Blocked 2$/ }))
    expect(screen.queryAllByText('WP A-1')).toHaveLength(0)
  })

  it('Reactivate stays disabled while the problem is unresolved, and says what is wrong', async () => {
    passes = [pass({ id: 'b', status: 'blocked', blockedReason: 'penalty', blockedAt: ts(WHEN) })]
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    const buttons = screen.getAllByRole('button', { name: 'Reactivate' })
    for (const b of buttons) expect(b).toBeDisabled()
    expect(screen.getAllByText(/Fix the problem first: A penalty is still in force/).length).toBeGreaterThan(0)
    expect(reactivateGatePass).not.toHaveBeenCalled()
  })

  it('Reactivate is enabled once the problem is resolved, asks to confirm, then calls the function', async () => {
    fixed.add('v1_d1')
    passes = [pass({ id: 'b', status: 'blocked', blockedReason: 'penalty', blockedAt: ts(WHEN) })]
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    const [button] = screen.getAllByRole('button', { name: 'Reactivate' })
    expect(button).toBeEnabled()
    await userEvent.click(button as HTMLElement)
    expect(reactivateGatePass).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate pass' }))
    await waitFor(() => expect(reactivateGatePass).toHaveBeenCalledWith({ passId: 'b' }))
  })

  it('blocking needs a note of at least 5 characters', async () => {
    passes = [pass({ id: 'a' })]
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    await userEvent.click(screen.getAllByRole('button', { name: 'Block' })[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block pass' }))
    expect(blockGatePass).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Write at least 5 characters.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox'), 'Seen speeding')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block pass' }))
    await waitFor(() => expect(blockGatePass).toHaveBeenCalledWith({ passId: 'a', note: 'Seen speeding' }))
  })

  it('shows an empty state when the month has no passes', async () => {
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    expect(screen.getByText('No passes for this month')).toBeInTheDocument()
  })

  it('adds a pass for one vehicle and driver in the middle of the month', async () => {
    issueGatePasses.mockResolvedValue({ issued: 1, results: [{ vehicleId: 'v1', driverId: 'd1', ok: true }] })
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    await userEvent.click(screen.getByRole('button', { name: 'Add gate pass' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Issue pass' })).toBeDisabled()
    await userEvent.selectOptions(within(dialog).getByLabelText('Vehicle'), 'v1')
    // The vehicle's only active driver is picked for you; the suspended one is not offered.
    expect(within(dialog).getByLabelText('Driver')).toHaveValue('d1')
    expect(within(dialog).queryByRole('option', { name: 'Gone Driver' })).toBeNull()
    expect(within(dialog).queryByRole('option', { name: 'WP SUSP-1' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue pass' }))
    await waitFor(() => expect(issueGatePasses).toHaveBeenCalledWith({ month: '2026-11', pairs: [{ vehicleId: 'v1', driverId: 'd1' }] }))
  })

  it('shows why a pass could not be added', async () => {
    issueGatePasses.mockResolvedValue({ issued: 0, results: [{ vehicleId: 'v1', driverId: 'd1', ok: false, error: 'not-eligible' }] })
    const { default: Page } = await import('./GatePassesPage')
    render(wrap(<Page />))
    await userEvent.click(screen.getByRole('button', { name: 'Add gate pass' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Vehicle'), 'v1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue pass' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
  })
})

describe('QualificationPage (month-end list)', () => {
  const metaDoc = (over: Partial<QualificationMeta> = {}): QualificationMeta =>
    ({ tenantId: 'T', month: '2026-12', computedAt: ts(WHEN), trigger: 'schedule', evaluatedCount: 5, qualifiedCount: 3, alreadyIssuedCount: 1, notEligibleCount: 1, failedCount: 0, truncated: false, ...over }) as QualificationMeta

  beforeEach(() => {
    meta = metaDoc()
    entries = [entry('v1', 'd1', 'WP A-1', 'Dan'), entry('v1', 'd2', 'WP A-1', 'Eve'), entry('v2', 'd1', 'WP B-2', 'Dan')]
  })

  it('has individual toggles and select all, and the button counts the selection', async () => {
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    const issue = () => screen.getByRole('button', { name: /^Issue/ })
    expect(issue()).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select WP A-1 with Dan' }))
    expect(issue()).toHaveTextContent('Issue 1 pass')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(issue()).toHaveTextContent('Issue 3 passes')
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(issue()).toBeDisabled()
  })

  it('issues exactly the selected pairs for the shown month', async () => {
    issueGatePasses.mockResolvedValue({ issued: 2, results: [{ vehicleId: 'v1', driverId: 'd2', ok: true }, { vehicleId: 'v2', driverId: 'd1', ok: true }] })
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select WP A-1 with Eve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select WP B-2 with Dan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Issue 2 passes' }))
    await waitFor(() =>
      expect(issueGatePasses).toHaveBeenCalledWith({
        month: '2026-12',
        pairs: [{ vehicleId: 'v1', driverId: 'd2' }, { vehicleId: 'v2', driverId: 'd1' }],
      }),
    )
  })

  it('reports the pairs the server refused, with the reason', async () => {
    issueGatePasses.mockResolvedValue({ issued: 0, results: [{ vehicleId: 'v1', driverId: 'd1', ok: false, error: 'not-eligible' }] })
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select WP A-1 with Dan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Issue 1 pass' }))
    expect(await screen.findByText('These were not issued')).toBeInTheDocument()
    expect(screen.getByText(/Not eligible: documents, penalties or the inspection need attention/)).toBeInTheDocument()
  })

  it('shows the stored list’s numbers and refreshes on request', async () => {
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    expect(screen.getByText(/3 qualified · 1 already have a pass · 1 not eligible/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Refresh list/ }))
    await waitFor(() => expect(refreshQualificationList).toHaveBeenCalledWith({ month: '2026-12' }))
  })

  it('says so when nothing was computed yet, and when nobody is waiting', async () => {
    meta = null
    entries = []
    const { default: Page } = await import('./QualificationPage')
    const first = render(wrap(<Page />))
    expect(screen.getByText('The list has not been computed yet.')).toBeInTheDocument()
    first.unmount()
    meta = metaDoc({ qualifiedCount: 0 })
    render(wrap(<Page />))
    expect(screen.getByText('Nobody is waiting for a pass')).toBeInTheDocument()
  })

  it('auto-issue is OFF by default and turning it on asks for confirmation first', async () => {
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    const toggle = screen.getByRole('switch', { name: /Auto-issue passes/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)
    expect(updateTenantSettings).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Turn on automatic passes?')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(updateTenantSettings).not.toHaveBeenCalled()
    await userEvent.click(toggle)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(updateTenantSettings).toHaveBeenCalledWith({ autoIssueGatePasses: true }))
  })

  it('turning it off also asks first', async () => {
    autoIssue = true
    const { default: Page } = await import('./QualificationPage')
    render(wrap(<Page />))
    const toggle = screen.getByRole('switch', { name: /Auto-issue passes/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(toggle)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(updateTenantSettings).toHaveBeenCalledWith({ autoIssueGatePasses: false }))
  })
})

describe('GatePassSection (vehicle and driver detail)', () => {
  it('shows Gate Pass: Not issued when the month has no pass', async () => {
    const { GatePassSection } = await import('./GatePassSection')
    render(wrap(<GatePassSection scope="admin" field="vehicleId" id="v1" />))
    expect(screen.getByText('Gate Pass: Not issued')).toBeInTheDocument()
  })
  it('shows Active, or Blocked with its reason', async () => {
    const { GatePassSection } = await import('./GatePassSection')
    passes = [pass({ id: 'a' })]
    const first = render(wrap(<GatePassSection scope="admin" field="vehicleId" id="v1" />))
    expect(screen.getByText('Gate Pass: Active')).toBeInTheDocument()
    first.unmount()
    passes = [pass({ id: 'a', status: 'blocked', blockedReason: 'inspection_invalidated' })]
    render(wrap(<GatePassSection scope="admin" field="vehicleId" id="v1" />))
    expect(screen.getByText('Gate Pass: Blocked (Inspection cancelled)')).toBeInTheDocument()
  })
  it('shows Expired when only an expired pass exists this month', async () => {
    const { GatePassSection } = await import('./GatePassSection')
    passes = [pass({ id: 'a', status: 'expired' })]
    render(wrap(<GatePassSection scope="supervisor" field="driverId" id="d1" />))
    expect(screen.getByText('Gate Pass: Expired')).toBeInTheDocument()
  })
  it('lists each driver’s pass when a vehicle has several', async () => {
    const { GatePassSection } = await import('./GatePassSection')
    passes = [pass({ id: 'a', driverName: 'Dan Driver' }), pass({ id: 'b', driverId: 'd2', driverName: 'Eve Driver', status: 'blocked', blockedReason: 'penalty' })]
    render(wrap(<GatePassSection scope="admin" field="vehicleId" id="v1" />))
    expect(screen.getByText('Dan Driver')).toBeInTheDocument()
    expect(screen.getByText('Eve Driver')).toBeInTheDocument()
    expect(screen.getByText('Gate Pass: Active')).toBeInTheDocument()
  })
})
