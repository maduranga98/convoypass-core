import { OPERATOR_HOME, ROLE_HOME, ROLES, type Role } from '@/lib/roles'

/** Only same-origin absolute paths; blocks open redirects like `//evil.com` or `/\evil.com`. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return null
  return next
}

const insideArea = (path: string, area: string): boolean =>
  path === area || path.startsWith(`${area}/`) || path.startsWith(`${area}?`) || path.startsWith(`${area}#`)

/**
 * `safeNext`, plus: the path must not be another role's area (or the Super admin console). A `next` left behind by a
 * previous session on a shared device (an admin signs out on /admin/..., a supervisor signs in) would otherwise land
 * the new user on the 403 page. Shared paths (/v/..., /notifications, /settings) are kept.
 */
export function nextForRole(role: Role, next: string | null | undefined): string | null {
  const path = safeNext(next)
  if (!path) return null
  const foreign = [...ROLES.filter((r) => r !== role).map((r) => ROLE_HOME[r]), OPERATOR_HOME]
  return foreign.some((area) => insideArea(path, area)) ? null : path
}

/** The office staff sign-in (email and password). `/login` itself is the PIN screen for drivers and security (Module 12). */
export const STAFF_LOGIN = '/login/staff'
const STAFF_AREAS = ['/admin', '/officer', '/supervisor', '/safety']

/**
 * Where a signed-out visitor goes: the PIN screen, or the staff form when they were headed for an office-staff area.
 * Shared paths (`/v/...`, `/notifications`, `/settings`) go to the PIN screen, which links to the staff form.
 */
export function loginUrl(next: string): string {
  const staff = STAFF_AREAS.some((area) => insideArea(next, area))
  return `${staff ? STAFF_LOGIN : '/login'}?next=${encodeURIComponent(next)}`
}

export function changePasswordUrl(next: string): string {
  return `/change-password?next=${encodeURIComponent(next)}`
}
