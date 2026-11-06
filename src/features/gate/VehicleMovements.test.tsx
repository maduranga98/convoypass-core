import 'fake-indexeddb/auto'
import { FirebaseError } from 'firebase/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PassWithId } from '@/types/passes'
import type { Visit } from '@/types/visits'
import type { WithId } from '@/types'

const ts = (ms: number) => ({ toMillis: () => ms }) as never
const FIRST_IN = Date.UTC(2026, 2, 10, 2, 0, 0)
let now = FIRST_IN + 3 * 3_600_000
let visits: WithId<Visit>[] = []
let uid = 'sec1'
let n = 0

const checkInVisit = vi.fn()
const checkOutVisit = vi.fn()
vi.mock('@/lib/api', () => ({ checkInVisit: (...a: unknown[]) => checkInVisit(...a), checkOutVisit: (...a: unknown[]) => checkOutVisit(...a) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid, claims: { tenantId: 'T' } }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { timezone: 'Asia/Colombo' } }) }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => now }))
vi.mock('./useVehicleVisits', () => ({ useVehicleVisits: () => ({ items: visits, status: 'ready' }) }))

const PASS = { id: 'veh_aaaaaaaaaa_20260310', dateKey: '20260310', checkIn: { at: ts(FIRST_IN) } } as unknown as PassWithId
const visit = (id: string, inAt: number, outAt: number | null): WithId<Visit> =>
  ({
    id, passId: PASS.id, vehicleId: 'veh_aaaaaaaaaa', tenantId: 'T',
    checkIn: { timestamp: ts(inAt), dateKey: '20260310' },
    checkOut: outAt === null ? null : { timestamp: ts(outAt) },
    status: outAt === null ? 'checked_in' : 'checked_out',
  }) as unknown as WithId<Visit>

const show = async (over: { readOnly?: boolean; online?: boolean } = {}) => {
  const { VehicleMovements } = await import('./VehicleMovements')
  render(<VehicleMovements vehicleId="veh_aaaaaaaaaa" plateNo="WP LJ-4821" pass={PASS} gate={{ id: 'main', name: 'Main Gate' }} online={over.online ?? true} readOnly={over.readOnly ?? false} />)
}

beforeEach(() => {
  uid = `sec${++n}` // one queue per account: a fresh one per test
  vi.stubGlobal('navigator', { onLine: true })
  now = FIRST_IN + 3 * 3_600_000
  visits = []
  checkInVisit.mockReset().mockResolvedValue({ outcome: 'checked_in', visitId: 'vis_x', at: now, driverName: 'D', plateNo: 'WP LJ-4821' })
  checkOutVisit.mockReset().mockResolvedValue({ visitId: 'vis_a', at: now, unloadingMissing: false })
})

describe('VehicleMovements', () => {
  it('a vehicle inside offers CHECK OUT (no PIN) and sends the visit id with one request id', async () => {
    visits = [visit('vis_a', FIRST_IN, null)]
    await show()
    expect(screen.getByText(/Inside since/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /CHECK OUT/ }))
    await waitFor(() => expect(checkOutVisit).toHaveBeenCalledTimes(1))
    expect(checkOutVisit).toHaveBeenCalledWith({ visitId: 'vis_a', requestId: expect.any(String) })
  })

  it('a vehicle outside, inside its gate time, offers CHECK IN AGAIN with the gate and no PIN', async () => {
    visits = [visit('vis_a', FIRST_IN, FIRST_IN + 3_600_000)]
    await show()
    expect(screen.getByText('Outside now')).toBeInTheDocument()
    expect(screen.getByText(/Gate time ends at/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /CHECK IN AGAIN/ }))
    await waitFor(() => expect(checkInVisit).toHaveBeenCalledTimes(1))
    const sent = checkInVisit.mock.calls[0]?.[0] as Record<string, unknown>
    expect(sent).toMatchObject({ vehicleId: 'veh_aaaaaaaaaa', gateId: 'main', visitId: expect.stringMatching(/^vis_[a-z0-9]{10}$/), requestId: expect.any(String) })
    expect(sent).not.toHaveProperty('pin')
  })

  it('after 16 hours from the first check-in there is no way back in, only the list', async () => {
    now = FIRST_IN + 16 * 3_600_000
    visits = [visit('vis_a', FIRST_IN, FIRST_IN + 3_600_000)]
    await show()
    expect(screen.getByText(/No more entries/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /CHECK IN AGAIN/ })).not.toBeInTheDocument()
  })

  it('a vehicle still inside after the gate time can always be checked out', async () => {
    now = FIRST_IN + 20 * 3_600_000
    visits = [visit('vis_a', FIRST_IN, null)]
    await show()
    expect(screen.getByRole('button', { name: /CHECK OUT/ })).toBeEnabled()
  })

  it('lists every in and out of the day, numbered', async () => {
    visits = [visit('vis_b', FIRST_IN + 2 * 3_600_000, null), visit('vis_a', FIRST_IN, FIRST_IN + 3_600_000)]
    await show()
    expect(screen.getByText('2 entries today')).toBeInTheDocument()
    expect(screen.getByText(/^1\. In /)).toBeInTheDocument()
    expect(screen.getByText(/^2\. In .*still inside/)).toBeInTheDocument()
  })

  it('shows the reasons when the shared eligibility check refuses the re-entry', async () => {
    visits = [visit('vis_a', FIRST_IN, FIRST_IN + 3_600_000)]
    checkInVisit.mockResolvedValue({
      outcome: 'blocked', driverName: 'D', plateNo: 'WP LJ-4821',
      eligibility: { status: 'blocked', blocked: true, eligible: false, checkedAt: 1, vehicle: { id: 'v', documentStatus: 'expired', blocked: false, penalties: [] }, driver: null, inspection: null },
    })
    await show()
    await userEvent.click(screen.getByRole('button', { name: /CHECK IN AGAIN/ }))
    expect(await screen.findByText('Vehicle documents expired')).toBeInTheDocument()
  })

  it('read-only roles get no buttons', async () => {
    visits = [visit('vis_a', FIRST_IN, null)]
    await show({ readOnly: true })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  describe('offline', () => {
    const queueOf = async () => (await import('./gateQueue')).queueFor(uid).list()

    it('CHECK OUT stays enabled offline: it is queued with the visit id and shows Pending sync', async () => {
      vi.stubGlobal('navigator', { onLine: false })
      visits = [visit('vis_a', FIRST_IN, null)]
      await show({ online: false })
      await userEvent.click(screen.getByRole('button', { name: /CHECK OUT/ }))
      expect(await screen.findByText('Pending sync')).toBeInTheDocument()
      expect(checkOutVisit).not.toHaveBeenCalled()
      const [item] = await queueOf()
      expect(item).toMatchObject({ type: 'checkOutVisit', status: 'waiting', plateNo: 'WP LJ-4821', vehicleId: 'veh_aaaaaaaaaa', payload: { visitId: 'vis_a', requestId: expect.any(String) } })
      expect(item?.requestId).toBe((item as { payload: { requestId: string } }).payload.requestId)
      // The vehicle cannot be moved twice while the first movement is waiting.
      expect(screen.queryByRole('button', { name: /CHECK/ })).not.toBeInTheDocument()
    })

    it('CHECK IN AGAIN is queued offline with its own visit id and the gate', async () => {
      vi.stubGlobal('navigator', { onLine: false })
      visits = [visit('vis_a', FIRST_IN, FIRST_IN + 3_600_000)]
      await show({ online: false })
      await userEvent.click(screen.getByRole('button', { name: /CHECK IN AGAIN/ }))
      expect(await screen.findByText('Pending sync')).toBeInTheDocument()
      expect(checkInVisit).not.toHaveBeenCalled()
      const [item] = await queueOf()
      expect(item).toMatchObject({ type: 'checkInVisit', payload: { vehicleId: 'veh_aaaaaaaaaa', gateId: 'main', visitId: expect.stringMatching(/^vis_[a-z0-9]{10}$/) } })
    })

    it('a network failure while "online" queues the same request id it just sent', async () => {
      visits = [visit('vis_a', FIRST_IN, null)]
      checkOutVisit.mockRejectedValue(new FirebaseError('functions/internal', 'internal'))
      await show()
      await userEvent.click(screen.getByRole('button', { name: /CHECK OUT/ }))
      expect(await screen.findByText('Pending sync')).toBeInTheDocument()
      const sent = checkOutVisit.mock.calls[0]?.[0] as { requestId: string }
      expect((await queueOf())[0]?.requestId).toBe(sent.requestId)
    })

    it('a typed server refusal is shown as an error and is not queued', async () => {
      visits = [visit('vis_a', FIRST_IN, null)]
      checkOutVisit.mockRejectedValue(Object.assign(new FirebaseError('functions/failed-precondition', 'no'), { details: { reason: 'visit-not-found' } }))
      await show()
      await userEvent.click(screen.getByRole('button', { name: /CHECK OUT/ }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByText('Pending sync')).not.toBeInTheDocument()
      expect(await queueOf()).toEqual([])
    })
  })

  it('shows nothing for a pass that was checked in before movements existed', async () => {
    visits = []
    await show()
    expect(screen.queryByText('Gate movements today')).not.toBeInTheDocument()
  })
})
