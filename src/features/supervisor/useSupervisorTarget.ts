import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { slaOf } from '@/lib/defaultSla'

/** Minutes a submitted pass may wait for its supervisor (tenant setting, default 30). */
export function useSupervisorTarget(): number {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  return slaOf(tenant.data).supervisorMinutes
}
