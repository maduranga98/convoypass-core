// Module 12: the driver home holds only the greeting, ONE scan button, one hint line, today's cards and a menu.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn())
const data = vi.hoisted(() => ({ vehicles: [] as unknown[], passes: [] as unknown[] }))
vi.mock('@/features/auth/useAuth', () => ({
  useSession: () => ({ uid: 'drv1', claims: { role: 'driver', tenantId: 'T1', contractorId: 'C1' }, profile: { name: 'Sunil' } }),
  useAuth: () => ({ signOut }),
}))
vi.mock('@/features/notifications/Bell', () => ({ Bell: () => <button type="button">Notifications</button> }))
vi.mock('@/features/qualifications/PermitsCard', () => ({ PermitsCard: () => null }))
vi.mock('@/features/notifications/PushOptInCard', () => ({ PushOptInCard: () => null }))
vi.mock('@/features/scan/QrScanner', () => ({ QrScanner: () => <div role="dialog" aria-label="Scan vehicle QR" /> }))
vi.mock('./queries', () => ({
  todayKey: () => '20261008',
  useTenant: () => ({ data: {} }),
  useMyVehicles: () => ({ isPending: false, isError: false, data: data.vehicles, refetch: vi.fn() }),
  useMyPasses: () => ({ isPending: false, isError: false, data: data.passes, retry: vi.fn() }),
}))

import DriverHome from './DriverHome'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.clearAllMocks()
  data.vehicles = [
    { id: 'veh_a', plateNo: 'WP LJ-4821', type: 'Tipper' },
    { id: 'veh_b', plateNo: 'CAB-1234', type: 'Lorry' },
    { id: 'veh_c', plateNo: 'NP KA 1234', type: 'Lorry' },
    { id: 'veh_d', plateNo: 'SP KB-9087', type: 'Lorry' },
  ]
  data.passes = [
    { id: 'p1', vehicleId: 'veh_a', dateKey: '20261008', status: 'officer_approved', attempt: 1 },
    { id: 'p2', vehicleId: 'veh_b', dateKey: '20261008', status: 'supervisor_approved', attempt: 2 },
    { id: 'p3', vehicleId: 'veh_c', dateKey: '20261008', status: 'rejected', attempt: 3, rejection: { reason: 'Dashcam lens dirty' } },
  ]
})

const renderHome = () => render(<MemoryRouter><DriverHome /></MemoryRouter>)

describe('DriverHome', () => {
  it('greets by name and has exactly one big Scan vehicle QR button and one hint line', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Sunil' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Scan vehicle QR' })).toHaveLength(1)
    expect(screen.getByText('Point the camera at the sticker on your vehicle')).toBeInTheDocument()
  })

  it('shows today as compact cards with plain chips; only "Fix needed" is a link', () => {
    renderHome()
    const list = screen.getByTestId('today-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    for (const chip of ['Approved', 'Waiting', 'Fix needed', 'Not checked yet']) expect(within(list).getByText(chip)).toBeInTheDocument()
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/v/veh_c')
    expect(links[0]).toHaveTextContent('Dashcam lens dirty')
  })

  it('never shows attempts, recent passes or long explanations', () => {
    renderHome()
    expect(screen.queryByText(/attempt/i)).toBeNull()
    expect(screen.queryByText(/recent/i)).toBeNull()
    expect(screen.queryByText(/how it works/i)).toBeNull()
    expect(screen.getAllByRole('heading')).toHaveLength(2) // greeting + Today
  })

  it('the menu holds Help and Sign out', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Tap Scan vehicle QR. Point at the sticker.')).toBeInTheDocument()
  })

  it('the scan button opens the shared in-app scanner', async () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Scan vehicle QR' }))
    expect(await screen.findByRole('dialog', { name: 'Scan vehicle QR' })).toBeInTheDocument()
  })
})
