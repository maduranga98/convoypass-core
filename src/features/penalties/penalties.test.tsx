import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverPicker } from '@/features/vehicles/DriverPicker'
import type { Driver, WithId } from '@/types'
import type { Penalty } from '@/types/penalties'
import type { PenaltyRow } from './model'

const NOW = Date.UTC(2026, 2, 10, 6, 0, 0)
const ts = (ms: number) => ({ toMillis: () => ms }) as never

const rows: PenaltyRow[] = []
const verifyPenalty = vi.fn()

vi.mock('@/lib/api', () => ({ verifyPenalty: (...a: unknown[]) => verifyPenalty(...a), revokePenalty: vi.fn() }))
vi.mock('./queries', () => ({ useTenantTimezone: () => 'Asia/Colombo' }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => NOW }))
vi.mock('./PenaltyPhoto', () => ({ PenaltyPhoto: () => <span data-testid="photo" /> }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { tenantId: 'T', contractorId: 'C1' } }) }))
vi.mock('./feed', () => ({
  usePenaltyFeed: () => ({ items: rows, isLoading: false, isError: false, error: null, capped: false, retry: vi.fn() }),
  useAwaitingReview: () => ({ items: rows, waiting: rows.filter((r) => r.verification.verifiedBy === null && r.status !== 'revoked'), isLoading: false, isError: false, error: null, capped: false, retry: vi.fn() }),
}))

const penalty = (over: Partial<Penalty> & { id: string }): PenaltyRow =>
  ({
    tenantId: 'T', contractorId: 'C1', target: { driverId: null, vehicleId: 'v1' }, targetLabels: { driverName: null, plateNo: 'WP LJ-4821' },
    typeId: 't', typeName: 'Safety Violation', duration: { kind: 'permanent' }, issuedBy: { uid: 'u', name: 'Sam Safety', role: 'safety' },
    issuedAt: ts(NOW - 3_600_000), reason: 'No helmet on site', evidencePhotoPath: null, status: 'active',
    verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
  }) as unknown as PenaltyRow

beforeEach(() => {
  rows.length = 0
  verifyPenalty.mockReset()
})

describe('status badges: word + icon, never colour alone', () => {
  it('shows a distinct word for active, expired and revoked, and strikes revoked through', async () => {
    const { PenaltyStatusBadge } = await import('./PenaltyBadges')
    render(
      <>
        <PenaltyStatusBadge status="active" />
        <PenaltyStatusBadge status="expired" />
        <PenaltyStatusBadge status="revoked" />
      </>,
    )
    expect(screen.getByText('Active · blocked').className).toContain('text-danger-strong')
    expect(screen.getByText('Expired').className).not.toContain('danger')
    expect(screen.getByText('Revoked').className).toContain('line-through')
  })
})

describe('Penalty history', () => {
  it('lists ALL penalties of the record: active, ended and revoked, each with its fields', async () => {
    const { PenaltyHistory } = await import('./PenaltyHistory')
    rows.push(
      penalty({ id: 'a' }),
      penalty({ id: 'b', status: 'expired', typeName: 'Late Return', duration: { kind: 'fixed', endDate: ts(NOW - 86_400_000) } }),
      penalty({ id: 'c', status: 'revoked', typeName: 'Damage', evidencePhotoPath: 'p', verification: { verifiedBy: 'sup', verifiedByName: 'Sue', verifiedAt: ts(NOW), verificationNote: null } }),
    )
    render(<PenaltyHistory scope="admin" vehicleId="v1" />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0] as HTMLElement).getByText('Active · blocked')).toBeInTheDocument()
    expect(within(items[0] as HTMLElement).getByText('Safety Violation')).toBeInTheDocument()
    expect(within(items[0] as HTMLElement).getByText('Awaiting supervisor review')).toBeInTheDocument()
    expect(within(items[0] as HTMLElement).getByText(/Sam Safety/)).toBeInTheDocument()
    expect(within(items[0] as HTMLElement).getByText('Permanent')).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText('Expired')).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText(/^Ended /)).toBeInTheDocument()
    expect(within(items[2] as HTMLElement).getByText('Revoked')).toBeInTheDocument()
    expect(within(items[2] as HTMLElement).getByText(/Reviewed by Sue/)).toBeInTheDocument()
    expect(within(items[2] as HTMLElement).getByTestId('photo')).toBeInTheDocument()
  })

  it('shows a stored-active penalty whose end passed as expired, even before the job runs', async () => {
    const { PenaltyHistory } = await import('./PenaltyHistory')
    rows.push(penalty({ id: 'a', duration: { kind: 'fixed', endDate: ts(NOW - 1) } }))
    render(<PenaltyHistory scope="admin" vehicleId="v1" />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Active · blocked')).not.toBeInTheDocument()
  })

  it('says so when there is nothing on record', async () => {
    const { PenaltyHistory } = await import('./PenaltyHistory')
    render(<PenaltyHistory scope="supervisor" driverId="d1" />)
    expect(screen.getByText('No penalties on record.')).toBeInTheDocument()
  })
})

describe('Supervisor verification queue: a confirmation, never an approval', () => {
  it('explains the penalty is already in force and offers only review actions', async () => {
    const { default: Queue } = await import('./VerificationQueuePage')
    rows.push(penalty({ id: 'a' }), penalty({ id: 'b', verification: { verifiedBy: 's', verifiedByName: 'Sue', verifiedAt: ts(NOW), verificationNote: 'ok' } }))
    render(<Queue />)
    expect(screen.getByText(/already in force/)).toBeInTheDocument()
    expect(screen.getByText(/does not approve, reject or lift anything/)).toBeInTheDocument()
    // Only the unreviewed one is in the first tab.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve|reject/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Reviewed/ }))
    expect(screen.getByText(/Reviewed by Sue/)).toBeInTheDocument()
  })

  it('"Mark as reviewed" sends the optional note and does not say approve', async () => {
    const { default: Queue } = await import('./VerificationQueuePage')
    verifyPenalty.mockResolvedValue({ ok: true })
    HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || (() => undefined)
    rows.push(penalty({ id: 'pen_aaaaaaaaaa' }))
    render(<Queue />)
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.type(screen.getByLabelText(/Note/), 'Spoke to driver')
    expect(screen.getByText(/The penalty stays in force/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark as reviewed', hidden: true }))
    expect(verifyPenalty).toHaveBeenCalledWith({ penaltyId: 'pen_aaaaaaaaaa', note: 'Spoke to driver' })
  })

  it('shows an empty state when nothing waits', async () => {
    const { default: Queue } = await import('./VerificationQueuePage')
    render(<Queue />)
    expect(screen.getByText('Nothing to review')).toBeInTheDocument()
  })
})

describe('DriverPicker with penalties (the assignment screen)', () => {
  const drivers = [
    { id: 'd1', name: 'Free Driver', contractorId: 'C1', status: 'active', phone: '94771111111' },
    { id: 'd2', name: 'Blocked Driver', contractorId: 'C1', status: 'active', phone: '94772222222' },
    { id: 'd3', name: 'Already Assigned', contractorId: 'C1', status: 'active', phone: '94773333333' },
  ] as unknown as WithId<Driver>[]

  it('disables a blocked driver that is not yet picked, but lets an already picked one be cleared', async () => {
    const onChange = vi.fn()
    render(<DriverPicker drivers={drivers} contractorId="C1" value={['d3']} onChange={onChange} blockedIds={new Set(['d2', 'd3'])} />)
    expect(screen.getByRole('checkbox', { name: /Free Driver/ })).toBeEnabled()
    const blocked = screen.getByRole('checkbox', { name: /Blocked Driver/ })
    expect(blocked).toBeDisabled()
    expect(screen.getAllByText('Blocked by penalty')).toHaveLength(2)
    await userEvent.click(blocked)
    expect(onChange).not.toHaveBeenCalled()
    const assigned = screen.getByRole('checkbox', { name: /Already Assigned/ })
    expect(assigned).toBeEnabled()
    await userEvent.click(assigned)
    expect(onChange).toHaveBeenCalledWith([])
  })
})
