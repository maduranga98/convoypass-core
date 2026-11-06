import { describe, expect, it } from 'vitest'
import { computePushEnv, isIosDevice, type BrowserSource } from './env'
import { DISMISS_DAYS, optInView } from './optIn'

const base: BrowserSource = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile', platform: 'Linux armv8l', maxTouchPoints: 5, standalone: false,
  hasNotification: true, hasServiceWorker: true, hasPushManager: true, permission: 'default',
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'
const DAY = 86_400_000
const NOW = 1_800_000_000_000

describe('push environment', () => {
  it('Android Chrome supports push', () => {
    expect(computePushEnv(base)).toMatchObject({ supported: true, ios: 'not-applicable', platform: 'android', permission: 'default' })
  })
  it('iPhone Safari in a tab needs the app installed first (no PushManager there)', () => {
    expect(computePushEnv({ ...base, userAgent: IPHONE, platform: 'iPhone', hasPushManager: false })).toMatchObject({ supported: false, ios: 'needs-install', platform: 'ios' })
  })
  it('an installed iOS web app supports push', () => {
    expect(computePushEnv({ ...base, userAgent: IPHONE, platform: 'iPhone', standalone: true })).toMatchObject({ supported: true, ios: 'installed' })
  })
  it('iPadOS pretending to be a Mac is still iOS', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15'
    expect(isIosDevice({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(isIosDevice({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
})

describe('opt-in card decision', () => {
  const env = computePushEnv(base)
  const view = (over: Partial<Parameters<typeof optInView>[0]> = {}) => optInView({ env, role: 'supervisor', enabledHere: false, dismissedAt: null, now: NOW, ...over })

  it('shows Enable on a capable browser that has not been asked', () => expect(view()).toBe('enable'))
  it('is hidden once enabled on this device', () => expect(view({ enabledHere: true })).toBe('hidden'))
  it('stays away for 14 days after a dismissal, then returns', () => {
    expect(DISMISS_DAYS).toBe(14)
    expect(view({ dismissedAt: NOW - 13 * DAY })).toBe('hidden')
    expect(view({ dismissedAt: NOW - 14 * DAY })).toBe('enable')
  })
  it('shows Add to Home Screen guidance on iOS outside the installed app, even with push unsupported', () => {
    const ios = computePushEnv({ ...base, userAgent: IPHONE, platform: 'iPhone', hasPushManager: false })
    expect(view({ env: ios })).toBe('ios-install')
    expect(view({ env: ios, dismissedAt: NOW - DAY })).toBe('hidden')
  })
  it('is hidden when the browser blocked notifications (Settings explains it), when unsupported, and for security guards', () => {
    expect(view({ env: computePushEnv({ ...base, permission: 'denied' }) })).toBe('hidden')
    expect(view({ env: computePushEnv({ ...base, hasPushManager: false }) })).toBe('hidden')
    expect(view({ role: 'security' })).toBe('hidden')
  })
})
