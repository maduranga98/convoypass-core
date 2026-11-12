import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FirebaseError } from 'firebase/app'

const h = vi.hoisted(() => ({
  issue: vi.fn(),
  usage: { cap: null as number | null, used: 0, ready: true, full: false, error: false },
}))

vi.mock('@/lib/api', () => ({ issueVisitorPass: h.issue }))
vi.mock('@/lib/storage', () => ({ uploadPhoto: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'admin', claims: { role: 'admin', tenantId: 'T1' } }) }))
vi.mock('@/features/passes/queries', () => ({
  useTenant: () => ({ data: { timezone: 'Asia/Colombo', gates: [{ id: 'main', name: 'Main Gate' }, { id: 'back', name: 'Back Gate' }] }, isPending: false }),
  todayKey: () => '20260310',
}))
vi.mock('./queries', () => ({
  useVisitors: () => ({ data: [{ id: 'vst_old0000001', fullName: 'Nimal Perera', phone: '94771234567', idNumber: '851234567V', idKey: '851234567V', organization: 'Audit Co', photoPath: null }] }),
  usePlanUsage: () => h.usage,
  usePassUsage: () => ({ data: h.usage.used, isError: false }),
}))
vi.mock('@/features/drivers/PhotoField', () => ({ PhotoField: () => null }))

import { IssuePassDrawer } from './IssuePassDrawer'

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } })

beforeEach(() => {
  h.issue.mockReset()
  h.usage = { cap: null, used: 0, ready: true, full: false, error: false }
  // jsdom has no <dialog> modal support
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open') }
})

describe('IssuePassDrawer', () => {
  it('validates, issues the pass and shows the QR, the short code and the print / WhatsApp actions', async () => {
    h.issue.mockResolvedValue({ passId: 'vsp_x', visitorId: 'vst_x', passCode: 'ABCDEFGH', qrPayload: 'https://app.example.com/vp/ABCDEFGH', validFrom: 1, validUntil: 2, siteId: 'main', siteName: 'Main Gate', used: 1, cap: null, created: true })
    render(<IssuePassDrawer open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    expect(await screen.findByText('Enter the visitor’s full name.')).toBeInTheDocument()
    expect(h.issue).not.toHaveBeenCalled()

    fill('Full name', 'Ann Lee')
    fill('Phone', '0771234567')
    fill('Who are they visiting', 'Finance')
    fill('Purpose of visit', 'Audit')
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))

    expect(await screen.findByTestId('pass-code')).toHaveTextContent('ABCD-EFGH')
    expect(h.issue).toHaveBeenCalledTimes(1)
    const sent = h.issue.mock.calls[0]?.[0]
    expect(sent).toMatchObject({ visitor: { fullName: 'Ann Lee', phone: '0771234567' }, hostName: 'Finance', purposeOfVisit: 'Audit', siteId: 'main', validFrom: '2026-03-10', validUntil: '2026-03-10' })
    expect(sent.passId).toMatch(/^vsp_[a-z0-9]{10}$/)
    expect(sent.visitorId).toMatch(/^vst_[a-z0-9]{10}$/)
    expect(screen.getByRole('img', { name: 'QR code of the visitor pass' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print slip' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', expect.stringContaining('https://wa.me/?text='))
  })

  it('reuses the same pass id when a failed submit is retried', async () => {
    h.issue.mockRejectedValueOnce(new FirebaseError('functions/unavailable', 'offline')).mockResolvedValueOnce({ passId: 'p', visitorId: 'v', passCode: 'ABCDEFGH', qrPayload: 'https://x/vp/ABCDEFGH', validFrom: 1, validUntil: 2, siteId: 'main', siteName: 'Main Gate', used: 1, cap: null, created: true })
    render(<IssuePassDrawer open onClose={vi.fn()} />)
    fill('Full name', 'Ann Lee')
    fill('Phone', '0771234567')
    fill('Purpose of visit', 'Audit')
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    await screen.findByTestId('pass-code')
    expect(h.issue.mock.calls[1]?.[0].passId).toBe(h.issue.mock.calls[0]?.[0].passId)
    expect(h.issue.mock.calls[1]?.[0].visitorId).toBe(h.issue.mock.calls[0]?.[0].visitorId)
  })

  it('fills a returning visitor from the search and reuses their record id', async () => {
    h.issue.mockResolvedValue({ passId: 'p', visitorId: 'vst_old0000001', passCode: 'ABCDEFGH', qrPayload: 'https://x/vp/ABCDEFGH', validFrom: 1, validUntil: 2, siteId: 'main', siteName: 'Main Gate', used: 1, cap: null, created: true })
    render(<IssuePassDrawer open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Returning visitor'), { target: { value: 'nim' } })
    fireEvent.click(await screen.findByRole('button', { name: /Nimal Perera/ }))
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Nimal Perera')
    expect(screen.getByLabelText(/^Phone/)).toHaveValue('0771234567')
    fill('Purpose of visit', 'Follow-up')
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    await screen.findByTestId('pass-code')
    expect(h.issue.mock.calls[0]?.[0]).toMatchObject({ visitorId: 'vst_old0000001', visitor: { idNumber: '851234567V', organization: 'Audit Co' } })
  })

  it('shows the plan usage on Starter and blocks issuing once the cap is reached', () => {
    h.usage = { cap: 20, used: 14, ready: true, full: false, error: false }
    const { unmount } = render(<IssuePassDrawer open onClose={vi.fn()} />)
    expect(screen.getByText('14 / 20 visitor passes used this month')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue pass' })).toBeEnabled()
    unmount()
    h.usage = { cap: 20, used: 20, ready: true, full: true, error: false }
    render(<IssuePassDrawer open onClose={vi.fn()} />)
    expect(screen.getAllByText('Monthly limit reached. Upgrade your plan to issue more passes.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Issue pass' })).toBeDisabled()
  })

  it('says the plan limit in words when the server refuses', async () => {
    h.issue.mockRejectedValue(Object.assign(new FirebaseError('functions/resource-exhausted', 'x'), { details: { reason: 'plan-limit-reached' } }))
    render(<IssuePassDrawer open onClose={vi.fn()} />)
    fill('Full name', 'Ann Lee')
    fill('Phone', '0771234567')
    fill('Purpose of visit', 'Audit')
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The monthly visitor pass limit of your plan is reached.')
  })
})
