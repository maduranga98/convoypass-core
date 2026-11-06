import type { ParsedToken } from 'firebase/auth'
import { isRole } from '@/lib/roles'
import type { Claims } from '@/types'

/** Claims come from the verified ID token. Returns null if the account has no valid role/tenant. */
export function parseClaims(token: ParsedToken): Claims | null {
  const { role, tenantId, contractorId } = token as Record<string, unknown>
  if (!isRole(role) || typeof tenantId !== 'string' || !tenantId) return null
  return { role, tenantId, contractorId: typeof contractorId === 'string' && contractorId ? contractorId : null }
}

/**
 * A platform operator (Module 9): claims { role: 'platform', platformAdmin: true } and NO tenantId. Anything that also
 * carries a tenant is not an operator. The server re-checks all of it on every call; this only picks the UI.
 */
export function isOperatorToken(token: ParsedToken): boolean {
  const { role, platformAdmin, tenantId } = token as Record<string, unknown>
  return role === 'platform' && platformAdmin === true && (tenantId === undefined || tenantId === null || tenantId === '')
}
