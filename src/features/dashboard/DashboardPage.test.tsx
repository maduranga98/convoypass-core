import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePass } from '@/test/passFactory'

type Next = (snap: { docs: { id: string; data: () => object }[] }) => void
const stops: ReturnType<typeof vi.fn>[] = []
const handlers: { q: unknown; next: Next }[] = []
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  query: (...a: unknown[]) => ({ query: a }),
  where: (...a: unknown[]) => ['where', ...a],
  orderBy: (...a: unknown[]) => ['orderBy', ...a],
  limit: (n: number) => ['limit', n],
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
  onSnapshot: (q: unknown, next: Next) => {
    handlers.push({ q, next })
    const stop = vi.fn()
    stops.push(stop)
    return stop
  },
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'u', claims: { role: 'admin', tenantId: 'T1', contractorId: null }, profile: { name: 'N' } }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ isPending: false, data: { timezone: 'Asia/Colombo', sla: { supervisorMinutes: 30, officerMinutes: 30 } } }) }))
vi.mock('@/features/passes/useToday', () => ({ useToday: () => '20260310', useNow: () => Date.now() }))
vi.mock('@/features/shared/queries', () => ({ useContractorList: () => ({ data: [{ id: 'C1', name: 'Alpha Haulage' }] }) }))
vi.mock('@/lib/api', () => ({ getDashboardTrend: vi.fn(async () => ({ days: [], timezone: 'Asia/Colombo', generatedAt: Date.now() })) }))
vi.mock('./TrendChart', () => ({ default: () => <div>chart</div> }))

import DashboardPage from './DashboardPage'

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DashboardPage scope="admin" />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  stops.length = 0
  handlers.length = 0
})

describe('DashboardPage', () => {
  it('listens to today’s passes and denials, shows the numbers live, and unsubscribes everything on unmount', async () => {
    const { unmount } = renderPage()
    expect(handlers).toHaveLength(2)
    expect(stops).toHaveLength(2)

    const passes = handlers.find((h) => JSON.stringify(h.q).includes('"passes"'))
    await act(async () => {
      passes?.next({
        docs: [
          makePass({ id: 'a', status: 'submitted' }),
          makePass({ id: 'b', status: 'checked_in' }),
          makePass({ id: 'c', status: 'checked_in' }),
        ].map((p) => ({ id: p.id, data: () => p })),
      })
    })
    const tile = (name: string) => screen.getByRole('link', { name: new RegExp(name) })
    expect(tile('Submitted today')).toHaveTextContent('3')
    expect(tile('Checked in today')).toHaveTextContent('2')
    expect(tile('Waiting supervisor')).toHaveTextContent('1')
    expect(tile('Checked in today')).toHaveAttribute('href', '/admin/passes?status=checked_in')
    expect(screen.queryByText(/on site/i)).toBeNull()

    for (const stop of stops) expect(stop).not.toHaveBeenCalled()
    unmount()
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1)
  })

  it('tells the user when today has more passes than it can show', async () => {
    renderPage()
    const passes = handlers.find((h) => JSON.stringify(h.q).includes('"passes"'))
    await act(async () => {
      passes?.next({ docs: Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, data: () => makePass({ id: `p${i}` }) })) })
    })
    expect(screen.getByRole('note')).toHaveTextContent('first 1000 passes')
  })
})
