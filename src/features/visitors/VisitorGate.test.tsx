// Security's Visitor mode: type a code, see who it is, one big button. Every refusal has its own words.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FirebaseError } from 'firebase/app'
import type { VisitorPassView } from '@/types/visitors'

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  inside: { data: [] as unknown[], isPending: false, isError: false },
  gates: [{ id: 'main', name: 'Main Gate' }] as { id: string; name: string }[],
}))

vi.mock('@/lib/api', () => ({ lookupVisitorPass: h.lookup, checkInVisitorPass: h.checkIn, checkOutVisitorPass: h.checkOut }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => Date.UTC(2026, 2, 10, 9, 0, 0) }))
vi.mock('./queries', () => ({ useInsideVisitors: () => h.inside }))
vi.mock('@/features/shared/queries', () => ({ useDriverPhotoUrl: () => ({ data: undefined }) }))
vi.mock('@/features/gate/useGate', () => ({ useGates: () => ({ gates: h.gates, gate: h.gates.length === 1 ? h.gates[0] : null, setGate: vi.fn() }) }))
vi.mock('@/features/gate/feedback', () => ({ playTone: vi.fn() }))
vi.mock('@/features/scan/QrScanner', () => ({ QrScanner: () => null }))

import VisitorGate from './VisitorGate'

const NOW = Date.UTC(2026, 2, 10, 9, 0, 0)
const view = (over: Partial<VisitorPassView> = {}): VisitorPassView => ({
  passId: 'vsp_aaaaaaaaaa', passCode: 'ABCDEFGH', status: 'active', entry: 'ok', visitorName: 'Nimal Perera', organization: 'Audit Co', hostName: 'Finance',
  purposeOfVisit: 'Quarterly audit', photoPath: null, siteId: 'main', siteName: 'Main Gate', validFrom: NOW - 3_600_000, validUntil: NOW + 3_600_000,
  maxDwellMinutes: 480, checkInAt: null, checkInByName: null, checkOutAt: null, overstay: false, revokeReason: null, ...over,
})
const typed = (reason: string) => Object.assign(new FirebaseError('functions/failed-precondition', 'x'), { details: { reason } })

const find = (code: string) => {
  fireEvent.change(screen.getByLabelText('Or type the pass code'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Find pass' }))
}

beforeEach(() => {
  h.lookup.mockReset()
  h.checkIn.mockReset()
  h.checkOut.mockReset()
  h.inside = { data: [], isPending: false, isError: false }
  h.gates = [{ id: 'main', name: 'Main Gate' }]
})

describe('VisitorGate', () => {
  it('has one scan button and a code field, and an empty inside list', () => {
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'SCAN VISITOR PASS' })).toBeInTheDocument()
    expect(screen.getByLabelText('Or type the pass code')).toBeInTheDocument()
    expect(screen.getByText('No visitors inside')).toBeInTheDocument()
  })

  it('finds a pass by typed code (any case, with a dash), shows who they are and checks them in with one tap', async () => {
    h.lookup.mockResolvedValue(view())
    h.checkIn.mockResolvedValue({ passId: 'vsp_aaaaaaaaaa', visitorName: 'Nimal Perera', at: NOW, recorded: true })
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('abcd-efgh')
    expect(await screen.findByText('READY TO CHECK IN')).toBeInTheDocument()
    expect(h.lookup).toHaveBeenCalledWith({ code: 'ABCDEFGH' })
    expect(screen.getByText('Nimal Perera')).toBeInTheDocument()
    expect(screen.getByText('Audit Co')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(screen.getByText('Quarterly audit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CHECK IN' }))
    expect(await screen.findByText('CHECKED IN')).toBeInTheDocument()
    expect(h.checkIn).toHaveBeenCalledWith({ passId: 'vsp_aaaaaaaaaa', siteId: 'main', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    fireEvent.click(screen.getByRole('button', { name: 'Scan next visitor' }))
    expect(screen.getByRole('button', { name: 'SCAN VISITOR PASS' })).toBeInTheDocument()
  })

  it('reuses the same request id when a failed check-in is retried (a network drop never records twice)', async () => {
    h.lookup.mockResolvedValue(view())
    h.checkIn.mockRejectedValueOnce(new FirebaseError('functions/unavailable', 'offline')).mockResolvedValueOnce({ passId: 'vsp_aaaaaaaaaa', visitorName: 'N', at: NOW, recorded: true })
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('ABCDEFGH')
    fireEvent.click(await screen.findByRole('button', { name: 'CHECK IN' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CHECK IN' }))
    await screen.findByText('CHECKED IN')
    expect(h.checkIn.mock.calls[0]?.[0].requestId).toBe(h.checkIn.mock.calls[1]?.[0].requestId)
  })

  it.each([
    [{ entry: 'expired' as const }, 'PASS EXPIRED'],
    [{ entry: 'not-yet-valid' as const }, 'NOT VALID YET'],
    [{ status: 'revoked' as const, entry: 'not-active' as const }, 'PASS CANCELLED'],
    [{ status: 'checked_out' as const, entry: 'not-active' as const }, 'PASS ALREADY USED'],
    [{ siteId: 'back', siteName: 'Back Gate' }, 'WRONG GATE'],
  ])('shows %j as "%s" with no check-in button', async (over, label) => {
    h.lookup.mockResolvedValue(view(over))
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('ABCDEFGH')
    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CHECK IN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'CHECK OUT' })).toBeNull()
  })

  it('offers CHECK OUT for a visitor who is inside, flags a stay that is too long, and checks them out', async () => {
    h.lookup.mockResolvedValue(view({ status: 'checked_in', entry: 'not-active', checkInAt: NOW - 600 * 60_000, overstay: true }))
    h.checkOut.mockResolvedValue({ passId: 'vsp_aaaaaaaaaa', visitorName: 'Nimal Perera', at: NOW, recorded: true })
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('ABCDEFGH')
    expect(await screen.findByText('ALREADY INSIDE')).toBeInTheDocument()
    expect(screen.getByText('STAYED TOO LONG')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CHECK IN' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }))
    expect(await screen.findByText('CHECKED OUT')).toBeInTheDocument()
    expect(h.checkOut).toHaveBeenCalledWith({ passId: 'vsp_aaaaaaaaaa', requestId: expect.any(String) })
  })

  it('says a server refusal in plain words (someone else checked them in first)', async () => {
    h.lookup.mockResolvedValue(view())
    h.checkIn.mockRejectedValue(typed('pass-already-checked-in'))
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('ABCDEFGH')
    fireEvent.click(await screen.findByRole('button', { name: 'CHECK IN' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This visitor is already inside.')
  })

  it('answers a code that cannot exist, and one the server does not know, with "PASS NOT FOUND"', async () => {
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('nonsense')
    expect(await screen.findByText('PASS NOT FOUND')).toBeInTheDocument()
    expect(h.lookup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    h.lookup.mockRejectedValue(typed('visitor-pass-not-found'))
    find('ABCDEFGH')
    expect(await screen.findByText('PASS NOT FOUND')).toBeInTheDocument()
  })

  it('offers Try again when the lookup fails on the network', async () => {
    h.lookup.mockRejectedValueOnce(new FirebaseError('functions/unavailable', 'offline')).mockResolvedValueOnce(view())
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    find('ABCDEFGH')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('READY TO CHECK IN')).toBeInTheDocument()
  })

  it('lists the visitors inside; a tap opens that visitor for check-out', async () => {
    h.inside = { data: [{ id: 'vsp_bbbbbbbbbb', visitorName: 'Sunil Silva', hostName: 'Stores', checkInAt: { toMillis: () => NOW - 3_600_000 }, dwellWarning: false }], isPending: false, isError: false }
    h.lookup.mockResolvedValue(view({ passId: 'vsp_bbbbbbbbbb', visitorName: 'Sunil Silva', status: 'checked_in', entry: 'not-active', checkInAt: NOW - 3_600_000 }))
    render(<MemoryRouter><VisitorGate /></MemoryRouter>)
    expect(screen.getByText('1 inside')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sunil Silva/ }))
    await waitFor(() => expect(h.lookup).toHaveBeenCalledWith({ passId: 'vsp_bbbbbbbbbb' }))
    expect(await screen.findByRole('button', { name: 'CHECK OUT' })).toBeInTheDocument()
  })
})
