import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { isoFromDateKey, type EligibilityStatus } from '@/lib/expiry'
import { effectiveVehicleTypes } from '@/lib/vehicleTypes'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'

/** The tenant's vehicle types (its own list, or the defaults) and today's date in its timezone. */
export function useTenantDocuments() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  return {
    isPending: tenant.isPending,
    vehicleTypes: effectiveVehicleTypes(tenant.data?.vehicleTypes),
    today: isoFromDateKey(dateKey(tenant.data?.timezone ?? DEFAULT_TIMEZONE)),
  }
}

/** Status of a record for the list filter; a record that predates expiry tracking has none and counts as valid. */
export const eligibilityOf = (r: { eligibilityStatus?: EligibilityStatus | undefined }): EligibilityStatus => r.eligibilityStatus ?? 'valid'
