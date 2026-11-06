import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enablePush = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ registerDevice: vi.fn(), unregisterDevice: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ app: {} }))
let role = 'supervisor'
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ uid: 'u1', claims: { role, tenantId: 'T1' }, profile: { name: 'N' } }) }))
vi.mock('./push/registration', async (orig) => ({ ...(await orig<typeof import('./push/registration')>()), enablePush: (...a: unknown[]) => enablePush(...a) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { PushOptInCard } from './PushOptInCard'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'
const setUa = (ua: string, platform = 'Linux armv8l') => {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
}
const capable = (permission: NotificationPermission = 'default') => {
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission, requestPermission: vi.fn() }))
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  role = 'supervisor'
  setUa('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile')
  capable()
})
afterEach(() => vi.unstubAllGlobals())

describe('PushOptInCard', () => {
  it('appears with an Enable button and never asks for permission by itself', () => {
    render(<PushOptInCard />)
    expect(screen.getByRole('heading', { name: 'Get alerts for approvals' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    expect(enablePush).not.toHaveBeenCalled()
    expect((Notification as unknown as { requestPermission: () => void }).requestPermission).not.toHaveBeenCalled()
  })

  it('Enable registers the device, reports the result and hides the card', async () => {
    enablePush.mockResolvedValue('enabled')
    render(<PushOptInCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alerts are on for this device.'))
    expect(enablePush).toHaveBeenCalledWith('u1')
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
  })

  it('a blocked permission is reported and the card goes away', async () => {
    enablePush.mockResolvedValue('denied')
    render(<PushOptInCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
  })

  it('a failure keeps the card so the person can try again', async () => {
    enablePush.mockResolvedValue('error')
    render(<PushOptInCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not turn on alerts. Try again later.'))
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
  })

  it('Not now hides it, remembers it, and a new visit within 14 days does not show it again', () => {
    const { unmount } = render(<PushOptInCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
    unmount()
    render(<PushOptInCard />)
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
  })

  it('shows again once the 14-day pause is over', () => {
    localStorage.setItem('convoypass.push.dismissed.u1', String(Date.now() - 15 * 86_400_000))
    render(<PushOptInCard />)
    expect(screen.getByRole('heading', { name: 'Get alerts for approvals' })).toBeInTheDocument()
  })

  it('iOS Safari outside the installed app shows Add to Home Screen instructions instead of Enable', () => {
    setUa(IPHONE, 'iPhone')
    vi.stubGlobal('PushManager', undefined)
    delete (globalThis as { PushManager?: unknown }).PushManager
    render(<PushOptInCard />)
    expect(screen.getByRole('heading', { name: 'Add to Home Screen to enable alerts' })).toBeInTheDocument()
    expect(screen.getByText(/Choose “Add to Home Screen”/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
  })

  it('security guards are not asked', () => {
    role = 'security'
    render(<PushOptInCard />)
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
  })

  it('stays hidden when notifications are blocked in the browser', () => {
    capable('denied')
    render(<PushOptInCard />)
    expect(screen.queryByRole('heading', { name: 'Get alerts for approvals' })).toBeNull()
  })
})
