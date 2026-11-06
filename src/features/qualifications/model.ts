import { useMemo } from 'react'
import { effectiveQualificationTypes, qualificationState, type QualificationRecords, type QualificationState, type QualificationTypeDef } from '@/lib/requirementLogic'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { useTenantDocuments } from '@/features/shared/documents'
import { DEFAULT_EXPIRY_WARNING_DAYS } from '@/lib/expiry'

/** The company's required qualifications (or the defaults), today's date in its timezone and the warning window. */
export function useRequirementContext() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const { today } = useTenantDocuments()
  const stored = tenant.data?.qualificationTypes
  // Stable between renders: lists below memoise on it.
  const types = useMemo(() => effectiveQualificationTypes(stored), [stored])
  return {
    isPending: tenant.isPending,
    types,
    usingDefaults: tenant.data?.qualificationTypes === undefined,
    today,
    warningDays: tenant.data?.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS,
  }
}

export interface QualificationCell {
  type: QualificationTypeDef
  state: QualificationState
  expiresOn: string | null
}

/** One driver's standing for each required type. */
export function cellsOf(types: readonly QualificationTypeDef[], records: QualificationRecords | undefined, today: string, warningDays: number): QualificationCell[] {
  return types.map((type) => {
    const record = records?.[type.id]
    return { type, state: qualificationState(record, today, warningDays), expiresOn: record?.expiresOn ?? null }
  })
}

/** Cells that stop the driver being eligible. */
export const problemCount = (cells: readonly QualificationCell[]): number => cells.filter((c) => c.state === 'missing' || c.state === 'expired').length
