import { useSession } from '@/features/auth/useAuth'

/** One set of feature components serves both: `admin` sees the whole tenant, `supervisor` is locked to their contractor. */
export type Scope = 'admin' | 'supervisor'

export const scopePath = (scope: Scope, page: 'vehicles' | 'drivers' | 'qr' | 'contractors'): string => `/${scope}/${page}`

/** Tenant and contractor come from the verified token claims, never from component props. */
export function useScope(scope: Scope) {
  const { claims } = useSession()
  return {
    tenantId: claims.tenantId,
    contractorId: scope === 'supervisor' ? claims.contractorId : null,
    isAdmin: scope === 'admin',
    /** A supervisor whose token has no contractor cannot load anything. */
    ready: scope === 'admin' || claims.contractorId !== null,
  }
}
