import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registerDevice = vi.hoisted(() => vi.fn<(payload: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true })))
const unregisterDevice = vi.hoisted(() => vi.fn<(payload: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true })))
const getToken = vi.hoisted(() => vi.fn<(messaging: unknown, options: unknown) => Promise<string>>(async () => 'fcm-token-abcdefghijklmnopqrstuvwxyz'))
const deleteToken = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/api', () => ({ registerDevice, unregisterDevice }))
vi.mock('@/lib/firebase', () => ({ app: {} }))
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), getToken, deleteToken, isSupported: async () => true }))

import { disablePush, enablePush, isPushEnabledHere, refreshPushRegistration, releaseDeviceOnSignOut } from './registration'
import { getDeviceId, isEnabledFlag } from './storage'

const browser = (permission: NotificationPermission, requestResult: NotificationPermission = permission) => {
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission, requestPermission: vi.fn(async () => requestResult) }))
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ scope: '/' }) }, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'vapid-public-key')
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile', configurable: true })
  Object.defineProperty(navigator, 'platform', { value: 'Linux armv8l', configurable: true })
  browser('default', 'granted')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('enablePush', () => {
  it('asks for permission, gets a token for the app’s own service worker and registers this device', async () => {
    expect(await enablePush('u1')).toBe('enabled')
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(getToken.mock.calls[0]?.[1]).toMatchObject({ vapidKey: 'vapid-public-key', serviceWorkerRegistration: { scope: '/' } })
    expect(registerDevice).toHaveBeenCalledWith({ deviceId: getDeviceId(), token: 'fcm-token-abcdefghijklmnopqrstuvwxyz', platform: 'android' })
    expect(isEnabledFlag('u1')).toBe(true)
  })
  it('does nothing when the person says no, and reports it', async () => {
    browser('default', 'denied')
    expect(await enablePush('u1')).toBe('denied')
    expect(registerDevice).not.toHaveBeenCalled()
    expect(isEnabledFlag('u1')).toBe(false)
  })
  it('reports an unsupported browser and a missing VAPID key without asking', async () => {
    vi.stubGlobal('PushManager', undefined)
    delete (globalThis as { PushManager?: unknown }).PushManager
    expect(await enablePush('u1')).toBe('unsupported')
    browser('default', 'granted')
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', '')
    expect(await enablePush('u1')).toBe('unconfigured')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })
  it('a failing token or registration is an error, not a crash, and does not mark the device enabled', async () => {
    getToken.mockRejectedValueOnce(new Error('fcm'))
    expect(await enablePush('u1')).toBe('error')
    registerDevice.mockRejectedValueOnce(new Error('network'))
    expect(await enablePush('u1')).toBe('error')
    expect(isEnabledFlag('u1')).toBe(false)
  })
})

describe('disable, sign out and refresh', () => {
  it('disablePush deletes the token and removes the device on the server', async () => {
    await enablePush('u1')
    await disablePush('u1')
    expect(deleteToken).toHaveBeenCalled()
    expect(unregisterDevice).toHaveBeenCalledWith({ deviceId: getDeviceId() })
    expect(isEnabledFlag('u1')).toBe(false)
  })
  it('signing out releases the device, but only when alerts were on, and never blocks', async () => {
    await releaseDeviceOnSignOut('u1')
    expect(unregisterDevice).not.toHaveBeenCalled()
    await enablePush('u1')
    unregisterDevice.mockImplementationOnce(() => new Promise(() => undefined)) // offline: never answers
    vi.useFakeTimers()
    const done = releaseDeviceOnSignOut('u1')
    await vi.advanceTimersByTimeAsync(1600)
    await done
    vi.useRealTimers()
    expect(isEnabledFlag('u1')).toBe(false)
  })
  it('enabled here means flag and permission together', async () => {
    await enablePush('u1')
    browser('granted')
    expect(isPushEnabledHere('u1')).toBe(true)
    browser('denied')
    expect(isPushEnabledHere('u1')).toBe(false)
    expect(isPushEnabledHere('u2')).toBe(false)
  })
  it('refresh re-registers at most once a day', async () => {
    await enablePush('u1')
    browser('granted')
    registerDevice.mockClear()
    await refreshPushRegistration('u1')
    expect(registerDevice).not.toHaveBeenCalled() // refreshed a moment ago
    localStorage.setItem('convoypass.push.refreshed.u1', String(Date.now() - 25 * 3_600_000))
    await refreshPushRegistration('u1')
    expect(registerDevice).toHaveBeenCalledTimes(1)
  })
})
