// Where the Super admin sign-in sends people back to. Only paths inside /platform are honoured: a `from` that points
// anywhere else (a workspace page, another site, //evil.com) is ignored.
import { OPERATOR_HOME } from '@/lib/roles'

export const PLATFORM_LOGIN = '/platform/login'
export const PLATFORM_CHANGE_PASSWORD = '/platform/change-password'
export const PLATFORM_SIGNUP = '/platform/signup'

/** `/platform`, or a path below it that is neither of the two auth pages. Anything else is null. */
export function safePlatformPath(raw: string | null | undefined): string | null {
  if (!raw || raw.includes('\\') || [...raw].some((c) => c.charCodeAt(0) < 32) || raw.startsWith('//')) return null
  let url: URL
  try {
    url = new URL(raw, 'https://x.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://x.invalid') return null
  const path = url.pathname
  if (path !== OPERATOR_HOME && !path.startsWith(`${OPERATOR_HOME}/`)) return null
  if (path === PLATFORM_LOGIN || path === PLATFORM_CHANGE_PASSWORD || path === PLATFORM_SIGNUP) return null
  return `${path}${url.search}${url.hash}`
}

export type LoginReason = 'reauth' | 'idle'

export function platformLoginUrl(from?: string, reason?: LoginReason): string {
  const q = new URLSearchParams()
  const safe = safePlatformPath(from)
  if (safe) q.set('from', safe)
  if (reason) q.set('reason', reason)
  const s = q.toString()
  return s ? `${PLATFORM_LOGIN}?${s}` : PLATFORM_LOGIN
}

export const changePasswordUrl = (next?: string): string => {
  const safe = safePlatformPath(next)
  return safe ? `${PLATFORM_CHANGE_PASSWORD}?next=${encodeURIComponent(safe)}` : PLATFORM_CHANGE_PASSWORD
}

// Why the next visit to the sign-in page happens (idle sign-out). Module state, not storage: nothing persists across a reload.
let pendingReason: LoginReason | undefined
export const setLoginReason = (r: LoginReason | undefined): void => {
  pendingReason = r
}
export const peekLoginReason = (): LoginReason | undefined => pendingReason
