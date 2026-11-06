// Session limits for the PIN roles (Module 12). Mirrors src/lib/session.ts in the web app (functions deploy from this
// folder only): keep both copies, and their tests, in sync. Pure: no firebase imports (the scripts import it).
import type { Role } from './types.js'

/** Only these roles sign in with a PIN. Admins, officers, supervisors and safety officers keep email and password. */
export const PIN_ROLES = ['driver', 'security', 'yard'] as const
export type PinRole = (typeof PIN_ROLES)[number]

export const isPinRole = (role: Role | string): role is PinRole => (PIN_ROLES as readonly string[]).includes(role)

/** Maximum age of a sign-in (token `auth_time`) for the PIN roles, in seconds. Other roles have no limit here. */
export const SESSION_MAX_AGE_SECONDS: Record<PinRole, number> = {
  driver: 90 * 24 * 60 * 60,
  security: 16 * 60 * 60,
  yard: 16 * 60 * 60,
}

/** True when a PIN-role session signed in at `authTime` (seconds) is too old at `now` (seconds). */
export function sessionExpired(role: Role, authTime: number, now: number): boolean {
  if (!isPinRole(role)) return false
  return now - authTime > SESSION_MAX_AGE_SECONDS[role]
}
