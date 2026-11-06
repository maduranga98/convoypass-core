import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface Doc { id: string; idx: number; data: () => Record<string, unknown> }
const ENTRIES = 60
const docs: Doc[] = Array.from({ length: ENTRIES }, (_, i) => ({
  id: `a${i}`, idx: i,
  data: () => ({
    tenantId: 'T1', action: i === 0 ? 'user.update' : 'pass.submit', actorUid: i === 0 ? 'u2' : 'u1', actorRole: 'driver', targetType: i === 0 ? 'user' : 'pass',
    targetId: i === 0 ? '=cmd' : `veh_x_${i}`, meta: i === 0 ? { name: true, phone: true } : { attempt: 1 }, createdAt: { toMillis: () => 1_700_000_000_000 - i * 60_000 },
  }),
}))
const calls: unknown[][][] = []
const getDocs = vi.fn(async (q: { constraints: unknown[][] }) => {
  calls.push(q.constraints)
  const after = q.constraints.find((c) => c[0] === 'startAfter')?.[1] as Doc | undefined
  const size = (q.constraints.find((c) => c[0] === 'limit')?.[1] as number) ?? 50
  const start = after ? after.idx + 1 : 0
  return { docs: docs.slice(start, start + size) }
})
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, name: string) => ({ name }),
  query: (_c: unknown, ...constraints: unknown[][]) => ({ constraints }),
  where: (...a: unknown[]) => ['where', ...a],
  orderBy: (...a: unknown[]) => ['orderBy', ...a],
  startAfter: (d: unknown) => ['startAfter', d],
  limit: (n: number) => ['limit', n],
  getDocs: (...a: Parameters<typeof getDocs>) => getDocs(...a),
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'admin', claims: { role: 'admin', tenantId: 'T1' }, profile: { name: 'Ann' } }) }))
vi.mock('@/features/passes/queries', () => ({ useTenant: () => ({ data: { timezone: 'Asia/Colombo' }, isPending: false }) }))
vi.mock('../queries', () => ({
  useUsers: () => ({ data: [{ id: 'u1', name: 'Dan Driver', role: 'driver', email: null }, { id: 'u2', name: '=Evil Admin', role: 'admin', email: 'e@x.com' }] }),
}))
const download = vi.fn()
vi.mock('@/features/reports/exports/download', () => ({ download: (...a: unknown[]) => download(...a) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import AuditPage from './AuditPage'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
})

const renderPage = (url = '/admin/audit?from=2026-03-01&to=2026-03-07') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <AuditPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
const rowsOf = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('AuditPage', () => {
  it('lists 25 rows newest first with time, actor and role, action, target and summary, scoped to the tenant and the date range', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(rowsOf()).toHaveLength(25)
    const first = rowsOf()[0] as HTMLElement
    expect(within(first).getByText('2023-11-15 03:43')).toBeInTheDocument()
    expect(within(first).getByText('=Evil Admin')).toBeInTheDocument()
    expect(within(first).getByText('User updated')).toBeInTheDocument()
    expect(within(first).getByText('Changed: name, phone')).toBeInTheDocument()
    const c = calls[0] ?? []
    expect(c).toContainEqual(['where', 'tenantId', '==', 'T1'])
    expect(c).toContainEqual(['orderBy', 'createdAt', 'desc'])
    expect(c.find((x) => x[0] === 'where' && x[1] === 'createdAt' && x[2] === '>=')?.[3]).toEqual({ ms: Date.parse('2026-02-28T18:30:00Z') })
    expect(c.find((x) => x[0] === 'where' && x[1] === 'createdAt' && x[2] === '<')?.[3]).toEqual({ ms: Date.parse('2026-03-07T18:30:00Z') })
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled()
  })

  it('pages with a cursor: Older loads the next 25 after the last entry shown, Newer goes back without a new read', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 2')
    const second = rowsOf()
    expect(second).toHaveLength(25)
    expect(within(second[0] as HTMLElement).getByText('veh_x_25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 3')
    expect(rowsOf()).toHaveLength(10) // 60 entries: 25 + 25 + 10
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled()
    const reads = getDocs.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(within(rowsOf()[0] as HTMLElement).getByText('User updated')).toBeInTheDocument()
    expect(getDocs.mock.calls.length).toBe(reads)
  })

  it('filters: the chosen action becomes a server-side where clause and the list restarts at page 1', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'user.update' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(calls.some((c) => c.some((x) => x[0] === 'where' && x[1] === 'action' && x[3] === 'user.update'))).toBe(true))
    await waitFor(() => expect(rowsOf()).toHaveLength(1))
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('actor and target filters combine: one is server-side, the other is applied to the rows', async () => {
    renderPage('/admin/audit?from=2026-03-01&to=2026-03-07&actor=u1&target=user')
    await screen.findByText(/no entries match/i)
    const c = calls[0] ?? []
    expect(c).toContainEqual(['where', 'actorUid', '==', 'u1'])
    expect(c.some((x) => x[1] === 'targetType')).toBe(false)
  })

  it('the detail drawer pretty-prints meta', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(within(rowsOf()[0] as HTMLElement).getByRole('button', { name: /Audit entry: User updated/ }))
    const meta = await screen.findByTestId('audit-meta')
    expect(meta.textContent).toBe(JSON.stringify({ name: true, phone: true }, null, 2))
    expect(meta.textContent).toContain('\n  "name": true')
  })

  it('exports the filtered view as CSV through the shared writer (formulas neutralised)', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [blob, fileName] = download.mock.calls[0] as [Blob, string]
    expect(fileName).toBe('convoypass_audit_2026-03-01_2026-03-07.csv')
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blob)
    })
    expect(text).toContain("'=Evil Admin")
    expect(text).toContain("'=cmd")
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1 + ENTRIES)
    expect(toast.success).toHaveBeenCalledWith('Exported 60 entries.')
  })

  it('shows an error state with a retry', async () => {
    getDocs.mockRejectedValueOnce(new Error('denied'))
    renderPage()
    expect(await screen.findByText(/could not load the audit log/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('table')
  })
})
