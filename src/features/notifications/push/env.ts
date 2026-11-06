export type IosState = 'not-applicable' | 'needs-install' | 'installed'
export type Platform = 'android' | 'ios' | 'desktop' | 'other'

/** What the browser tells us, gathered in one place so tests can hand in any browser. */
export interface BrowserSource {
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  hasNotification: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  permission: NotificationPermission | 'unsupported'
}

export interface PushEnv {
  /** The browser can receive web push right now. False on iOS Safari until the app is on the Home Screen. */
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  ios: IosState
  platform: Platform
}

/** iPhone, iPod and iPad, including iPadOS 13+ which reports itself as a Mac with a touch screen. */
export const isIosDevice = (s: Pick<BrowserSource, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean =>
  /iPhone|iPad|iPod/.test(s.userAgent) || (s.platform === 'MacIntel' && s.maxTouchPoints > 1)

export function computePushEnv(s: BrowserSource): PushEnv {
  const ios = isIosDevice(s)
  const platform: Platform = ios ? 'ios' : /Android/i.test(s.userAgent) ? 'android' : /Windows|Macintosh|Linux|CrOS/.test(s.userAgent) ? 'desktop' : 'other'
  return {
    supported: s.hasNotification && s.hasServiceWorker && s.hasPushManager,
    permission: s.permission,
    // Web push on iOS works for an installed web app only (16.4+). In a Safari tab there is no PushManager at all.
    ios: !ios ? 'not-applicable' : s.standalone ? 'installed' : 'needs-install',
    platform,
  }
}

export function browserSource(): BrowserSource {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const win = typeof window === 'undefined' ? undefined : window
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone:
      Boolean((nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone) ||
      Boolean(win?.matchMedia?.('(display-mode: standalone)').matches),
    hasNotification: Boolean(win && 'Notification' in win),
    hasServiceWorker: Boolean(nav && 'serviceWorker' in nav),
    hasPushManager: Boolean(win && 'PushManager' in win),
    permission: win && 'Notification' in win ? Notification.permission : 'unsupported',
  }
}

export const readPushEnv = (): PushEnv => computePushEnv(browserSource())
