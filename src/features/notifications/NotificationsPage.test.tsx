import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Doc { id: string; idx: number; data: () => Record<string, unknown> }
const TOTAL = 60
const docs: Doc[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: `n${i}`, idx: i,
  data: () => ({
    type: 'approval_needed', title: `Title ${i}`, body: `Body ${i}`, link: `/supervisor/approvals/p${i}`, tenantId: 'T1', recipientUid: 'u1',
    createdAt: { toDate: () => new Date(Date.now() - i * 60_000) }, readAt: i === 3 ? { toDate: () => new Date() } : null,
  }),
}))
const calls: unknown[][][] = []
const getDocs = vi.fn(async (q: { constraints: unknown[][] }) => {
  calls.push(q.constraints)
  const after = q.constraints.find((c) => c[0] === 'startAfter')?.[1] as Doc | undefined
  const size = q.constraints.find((c) => c[0] === 'limit')?.[1] as number
  const start = after ? after.idx + 1 : 0
  return { docs: docs.slice(start, start + size) }
})
const batchUpdate = vi.fn()
const batchCommit = vi.fn(async () => undefined)
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, name: string) => ({ name }),
  query: (_c: unknown, ...constraints: unknown[][]) => ({ constraints }),
  where: (...a: unknown[]) => ['where', ...a],
  orderBy: (...a: unknown[]) => ['orderBy', ...a],
  startAfter: (d: unknown) => ['startAfter', d],
  limit: (n: number) => ['limit', n],
  getDocs: (...a: Parameters<typeof getDocs>) => getDocs(...a),
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  serverTimestamp: () => 'SERVER_TIME',
  writeBatch: () => ({ update: batchUpdate, commit: batchCommit }),
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'u1', claims: { role: 'supervisor', tenantId: 'T1' }, profile: { name: 'N' } }) }))
vi.mock('./feedContext', () => ({ useNotificationFeed: () => ({ unread: 5, markAllRead: async () => undefined }) }))

import NotificationsPage, { PAGE_SIZE } from './NotificationsPage'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
const setup = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
})

describe('NotificationsPage', () => {
  it('loads 25 per page for this tenant and recipient, newest first, and pages with a cursor', async () => {
    expect(PAGE_SIZE).toBe(25)
    setup()
    await screen.findByText('Title 0')
    expect(screen.getAllByRole('listitem')).toHaveLength(25)
    const first = calls[0] ?? []
    expect(first).toContainEqual(['where', 'tenantId', '==', 'T1'])
    expect(first).toContainEqual(['where', 'recipientUid', '==', 'u1'])
    expect(first).toContainEqual(['orderBy', 'createdAt', 'desc'])
    expect(first).toContainEqual(['limit', 25])
    expect(first.some((c) => c[0] === 'startAfter')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText('Title 49')
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    expect((calls[1] ?? []).find((c) => c[0] === 'startAfter')?.[1]).toMatchObject({ id: 'n24' }) // continues right after the last one shown

    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText('Title 59')
    expect(screen.getAllByRole('listitem')).toHaveLength(60)
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull()
    expect(screen.getByText('That is everything.')).toBeInTheDocument()
  })

  it('shows read and unread, and opening an unread item marks it read and navigates', async () => {
    setup()
    await screen.findByText('Title 0')
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText(/Unread/)).toBeInTheDocument()
    expect(within(rows[3] as HTMLElement).queryByText(/Unread/)).toBeNull() // n3 is read
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    await waitFor(() => expect(batchCommit).toHaveBeenCalledTimes(1))
    expect(batchUpdate).toHaveBeenCalledWith({ path: 'notifications/n0' }, { readAt: 'SERVER_TIME' })
    expect(await screen.findByTestId('where')).toHaveTextContent('/supervisor/approvals/p0')
  })

  it('opening one that is already read does not write', async () => {
    setup()
    await screen.findByText('Title 3')
    fireEvent.click(within(screen.getAllByRole('listitem')[3] as HTMLElement).getByRole('button'))
    expect(batchCommit).not.toHaveBeenCalled()
  })

  it('shows an error state with a retry and an empty state', async () => {
    getDocs.mockRejectedValueOnce(new Error('denied'))
    const { unmount } = setup()
    expect(await screen.findByText(/could not load notifications/i)).toBeInTheDocument()
    unmount()
    getDocs.mockResolvedValueOnce({ docs: [] })
    setup()
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })
})
