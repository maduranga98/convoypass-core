import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[] }
const unsubscribe = vi.fn()
let emit: (snap: Snap) => void = () => undefined
let fail: (e: Error) => void = () => undefined
const onSnapshot = vi.fn((_q: unknown, next: (s: Snap) => void, error: (e: Error) => void) => {
  emit = next
  fail = error
  return unsubscribe
})
const updateDoc = vi.fn(async () => undefined)
const batchUpdate = vi.fn()
const batchCommit = vi.fn(async () => undefined)
const where = vi.fn((...a: unknown[]) => ['where', ...a])
const limit = vi.fn((n: number) => ['limit', n])

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  query: (...a: unknown[]) => ({ query: a }),
  where: (...a: unknown[]) => where(...a),
  orderBy: (...a: unknown[]) => ['orderBy', ...a],
  limit: (n: number) => limit(n),
  onSnapshot: (...a: Parameters<typeof onSnapshot>) => onSnapshot(...a),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...a: Parameters<typeof updateDoc>) => updateDoc(...a),
  serverTimestamp: () => 'SERVER_TIME',
  writeBatch: () => ({ update: batchUpdate, commit: batchCommit }),
}))
vi.mock('@/lib/firebase', () => ({ db: {}, app: {} }))
vi.mock('@/features/auth/useAuth', () => ({
  useSession: () => ({ uid: 'u1', claims: { role: 'supervisor', tenantId: 'T1', contractorId: 'C1' }, profile: { name: 'N' } }),
}))
vi.mock('./push/foreground', () => ({ subscribeForegroundPush: async () => () => undefined }))

import { Bell } from './Bell'
import { NotificationsProvider } from './NotificationsProvider'

const stamp = (d: Date) => ({ toDate: () => d })
const n = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: () => ({
    type: 'approval_needed', title: `Title ${id}`, body: `Body ${id}`, link: `/supervisor/approvals/${id}`, tenantId: 'T1', recipientUid: 'u1',
    createdAt: stamp(new Date(Date.now() - 5 * 60_000)), readAt: null, ...over,
  }),
})

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
const setup = () =>
  render(
    <MemoryRouter initialEntries={['/supervisor']}>
      <NotificationsProvider>
        <Routes>
          <Route path="*" element={<><Bell /><Where /></>} />
        </Routes>
      </NotificationsProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  document.title = 'ConvoyPass'
})

describe('Bell', () => {
  it('listens to the last 50 for this tenant and recipient, newest first, and unsubscribes on unmount', () => {
    const { unmount } = setup()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledWith('tenantId', '==', 'T1')
    expect(where).toHaveBeenCalledWith('recipientUid', '==', 'u1')
    expect(limit).toHaveBeenCalledWith(50)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('the badge and the tab title follow the live snapshot', () => {
    setup()
    expect(screen.queryByTestId('bell-badge')).toBeNull()
    act(() => emit({ docs: [n('a'), n('b')] }))
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
    expect(document.title).toBe('(2) ConvoyPass')
    // A third arrives live; one gets read elsewhere.
    act(() => emit({ docs: [n('c'), n('a', { readAt: stamp(new Date()) }), n('b')] }))
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2')
    act(() => emit({ docs: [n('c', { readAt: stamp(new Date()) }), n('a', { readAt: stamp(new Date()) }), n('b', { readAt: stamp(new Date()) })] }))
    expect(screen.queryByTestId('bell-badge')).toBeNull()
    expect(document.title).toBe('ConvoyPass')
  })

  it('opens a panel with title, body, relative time and an unread marker', () => {
    setup()
    act(() => emit({ docs: [n('a'), n('b', { readAt: stamp(new Date()) })] }))
    fireEvent.click(screen.getByRole('button', { name: /notifications, 1 unread/i }))
    const panel = screen.getByRole('region', { name: 'Notifications' })
    expect(within(panel).getByText('Title a')).toBeInTheDocument()
    expect(within(panel).getByText('Body a')).toBeInTheDocument()
    expect(within(panel).getAllByText(/ago/).length).toBe(2)
    expect(within(panel).getByText('Unread:', { exact: false })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/notifications')
  })

  it('clicking an item marks it read (readAt = server time) and navigates to its link', async () => {
    setup()
    act(() => emit({ docs: [n('a')] }))
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Title a/ })))
    expect(updateDoc).toHaveBeenCalledWith({ path: 'notifications/a' }, { readAt: 'SERVER_TIME' })
    expect(screen.getByTestId('where')).toHaveTextContent('/supervisor/approvals/a')
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull() // closed after navigating
  })

  it('an already read item navigates without writing', async () => {
    setup()
    act(() => emit({ docs: [n('a', { readAt: stamp(new Date()) })] }))
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Title a/ })))
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('never navigates to another site: an absolute link falls back to home', async () => {
    setup()
    act(() => emit({ docs: [n('x', { link: 'https://evil.example/phish' })] }))
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Title x/ })))
    expect(screen.getByTestId('where')).toHaveTextContent('/')
  })

  it('Mark all read updates every unread item in one batch (at most 50)', async () => {
    setup()
    act(() => emit({ docs: [n('a'), n('b'), n('c', { readAt: stamp(new Date()) })] }))
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })))
    expect(batchUpdate).toHaveBeenCalledTimes(2)
    expect(batchUpdate).toHaveBeenCalledWith({ path: 'notifications/a' }, { readAt: 'SERVER_TIME' })
    expect(batchUpdate).toHaveBeenCalledWith({ path: 'notifications/b' }, { readAt: 'SERVER_TIME' })
    expect(batchCommit).toHaveBeenCalledTimes(1)
  })

  it('caps one batch at 50 even when more are unread', async () => {
    setup()
    act(() => emit({ docs: Array.from({ length: 60 }, (_, i) => n(`n${i}`)) }))
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })))
    expect(batchUpdate).toHaveBeenCalledTimes(50)
  })

  it('shows empty and error states, and Escape closes the panel', () => {
    setup()
    act(() => emit({ docs: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
    act(() => fail(new Error('denied')))
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i)
  })
})
