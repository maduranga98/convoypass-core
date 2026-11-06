import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePass } from '@/test/passFactory'

const unsubscribe = vi.fn()
type Next = (snap: { docs: { id: string; data: () => object }[] }) => void
type Fail = (e: Error) => void
const listeners: { next: Next; error: Fail }[] = []
const onSnapshot = vi.fn((_q: unknown, next: Next, error: Fail) => {
  listeners.push({ next, error })
  return unsubscribe
})
const where = vi.fn((...a: unknown[]) => ['where', ...a])
const orderBy = vi.fn((...a: unknown[]) => ['orderBy', ...a])
const limit = vi.fn((n: number) => ['limit', n])

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  query: (...a: unknown[]) => ({ query: a }),
  where: (...a: unknown[]) => where(...a),
  orderBy: (...a: unknown[]) => orderBy(...a),
  limit: (n: number) => limit(n),
  onSnapshot: (...a: Parameters<typeof onSnapshot>) => onSnapshot(...a),
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
let claims = { role: 'supervisor', tenantId: 'T1', contractorId: 'C1' }
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'u', claims, profile: { name: 'N' } }) }))

import { activeQueueCount } from './passQueueStore'
import { QUEUE_LIMIT, usePassQueue, type PassQueueOptions } from './usePassQueue'

function List({ opts, label = 'list' }: { opts: PassQueueOptions; label?: string }) {
  const q = usePassQueue(opts)
  return <p data-testid={label}>{q.isError ? 'error' : q.isLoading ? 'loading' : q.items.map((p) => p.plateNo).join(',') || 'empty'}</p>
}

const docs = (...plates: string[]) => ({ docs: plates.map((p) => ({ id: p, data: () => ({ ...makePass({ plateNo: p }), id: undefined }) })) })

beforeEach(() => {
  vi.clearAllMocks()
  listeners.length = 0
  claims = { role: 'supervisor', tenantId: 'T1', contractorId: 'C1' }
})

describe('usePassQueue', () => {
  it('subscribes once, shows items live, and unsubscribes on unmount', () => {
    const { unmount } = render(<List opts={{ scope: 'supervisor', status: 'submitted', dateKey: '20260310' }} />)
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('list')).toHaveTextContent('loading')

    act(() => listeners[0]?.next(docs('AAA-1', 'BBB-2')))
    expect(screen.getByTestId('list')).toHaveTextContent('AAA-1,BBB-2')
    act(() => listeners[0]?.next(docs('AAA-1')))
    expect(screen.getByTestId('list')).toHaveTextContent('AAA-1')

    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(activeQueueCount()).toBe(0)
  })

  it('two components with the same query share one listener, released with the last one', () => {
    const opts: PassQueueOptions = { scope: 'supervisor', status: 'submitted', dateKey: '20260310' }
    const a = render(<List opts={opts} label="badge" />)
    const b = render(<List opts={opts} label="list" />)
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    act(() => listeners[0]?.next(docs('AAA-1')))
    expect(screen.getByTestId('badge')).toHaveTextContent('AAA-1')
    expect(screen.getByTestId('list')).toHaveTextContent('AAA-1')
    a.unmount()
    expect(unsubscribe).not.toHaveBeenCalled()
    b.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('builds the query the rules require: tenant and, for supervisors, their own contractor from the claims', () => {
    render(<List opts={{ scope: 'supervisor', status: ['supervisor_approved', 'officer_approved'], dateKey: '20260310' }} />)
    const calls = where.mock.calls.map((c) => c.join(' '))
    expect(calls).toContain('tenantId == T1')
    expect(calls).toContain('contractorId == C1')
    expect(calls).toContain('dateKey == 20260310')
    expect(where).toHaveBeenCalledWith('status', 'in', ['supervisor_approved', 'officer_approved'])
    expect(orderBy).toHaveBeenCalledWith('submittedAt', 'desc')
    expect(limit).toHaveBeenCalledWith(QUEUE_LIMIT)
  })

  it('an officer query is tenant-wide and a supervisor without a contractor never subscribes', () => {
    claims = { role: 'officer', tenantId: 'T1', contractorId: null as unknown as string }
    const { unmount } = render(<List opts={{ scope: 'officer', status: 'supervisor_approved', dateKey: '20260310' }} />)
    expect(where.mock.calls.some((c) => c[0] === 'contractorId')).toBe(false)
    unmount()
    vi.clearAllMocks()
    claims = { role: 'supervisor', tenantId: 'T1', contractorId: null as unknown as string }
    render(<List opts={{ scope: 'supervisor', status: 'submitted' }} />)
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('the expired list uses a day range, newest day first', () => {
    claims = { role: 'officer', tenantId: 'T1', contractorId: null as unknown as string }
    render(<List opts={{ scope: 'officer', status: ['submitted', 'supervisor_approved'], before: '20260310' }} />)
    expect(where).toHaveBeenCalledWith('dateKey', '<', '20260310')
    expect(orderBy).toHaveBeenNthCalledWith(1, 'dateKey', 'desc')
  })

  it('reports errors and does not subscribe when disabled', () => {
    render(<List opts={{ scope: 'supervisor', status: 'submitted', dateKey: '20260310' }} />)
    act(() => listeners[0]?.error(new Error('offline')))
    expect(screen.getByTestId('list')).toHaveTextContent('error')
    vi.clearAllMocks()
    render(<List opts={{ scope: 'supervisor', status: 'rejected', dateKey: '20260310', enabled: false }} label="off" />)
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(screen.getByTestId('off')).toHaveTextContent('loading')
  })
})
