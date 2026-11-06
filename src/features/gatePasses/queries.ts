import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { liveQuery, useLiveQuery } from '@/lib/liveQuery'
import { useSession } from '@/features/auth/useAuth'
import { useScope, type Scope } from '@/features/shared/scope'
import { blockGatePass, checkEligibility, issueGatePasses, reactivateGatePass, refreshQualificationList, updateTenantSettings } from '@/lib/api'
import { db } from '@/lib/firebase'
import { qualificationId } from '@/lib/gatePassLogic'
import type { WithId } from '@/types'
import type { GatePass, IssueGatePassesPayload, QualificationEntry, QualificationMeta } from '@/types/gatePasses'

export const MAX_PASSES = 1000

/**
 * Every pass of one month, for the Company Admin (whole company) or a supervisor (own contractor). The query carries the
 * clauses the rules require. Blocks happen on the server, so the list is live: a block shows up by itself.
 */
export function useGatePasses(scope: Scope, month: string) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(
    ['gatePasses', tenantId, contractorId ?? 'all', month],
    liveQuery(
      query(
        collection(db, 'gatePasses'),
        where('tenantId', '==', tenantId),
        ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
        where('month', '==', month),
        limit(MAX_PASSES),
      ),
      (snap): WithId<GatePass>[] => snap.docs.map((d) => ({ ...(d.data() as GatePass), id: d.id })),
    ),
    ready,
  )
}

/**
 * The most recent passes of one vehicle or one driver, newest month first (the detail drawers show the current month's and
 * the earlier ones). `enabled` lets a viewer without access (officer, security) skip the read.
 */
export function useGatePassesOf(scope: Scope, field: 'vehicleId' | 'driverId', id: string, enabled = true) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useLiveQuery(
    ['gatePasses', tenantId, contractorId ?? 'all', field, id],
    liveQuery(
      query(
        collection(db, 'gatePasses'),
        where('tenantId', '==', tenantId),
        ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
        where(field, '==', id),
        orderBy('month', 'desc'),
        limit(12),
      ),
      (snap): WithId<GatePass>[] => snap.docs.map((d) => ({ ...(d.data() as GatePass), id: d.id })),
    ),
    ready && enabled,
  )
}

export interface Qualification {
  meta: QualificationMeta | null
  entries: WithId<QualificationEntry>[]
}

/** The stored month-end list (admin only): nothing is computed when the page opens. */
export function useQualification(month: string) {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['qualification', claims.tenantId, month],
    staleTime: 30_000,
    queryFn: async (): Promise<Qualification> => {
      const id = qualificationId(claims.tenantId, month)
      const [meta, entries] = await Promise.all([
        getDoc(doc(db, 'monthEndQualification', id)),
        getDocs(query(collection(db, 'monthEndQualification', id, 'entries'), where('tenantId', '==', claims.tenantId), limit(MAX_PASSES * 5))),
      ])
      return {
        meta: meta.exists() ? (meta.data() as QualificationMeta) : null,
        entries: entries.docs.map((d) => ({ ...(d.data() as QualificationEntry), id: d.id })).sort((a, b) => a.plateNo.localeCompare(b.plateNo) || a.driverName.localeCompare(b.driverName)),
      }
    },
  })
}

/** Can a blocked pass come back? The shared eligibility check, read-only; the server repeats it when the admin confirms. */
export function useReactivationCheck(vehicleId: string, driverId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['gatePassEligibility', vehicleId, driverId],
    enabled,
    staleTime: 15_000,
    queryFn: () => checkEligibility({ vehicleId, driverId }),
  })
}

/** Writes are callables; every one refreshes the lists it changed. */
export function useGatePassMutations() {
  const queryClient = useQueryClient()
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['gatePasses'] }), queryClient.invalidateQueries({ queryKey: ['qualification'] }), queryClient.invalidateQueries({ queryKey: ['gatePassEligibility'] })])
  return {
    issue: useMutation({ mutationFn: (p: IssueGatePassesPayload) => issueGatePasses(p), onSettled: refresh }),
    block: useMutation({ mutationFn: (p: { passId: string; note: string }) => blockGatePass(p), onSettled: refresh }),
    reactivate: useMutation({ mutationFn: (passId: string) => reactivateGatePass({ passId }), onSettled: refresh }),
    refreshList: useMutation({ mutationFn: (month: string) => refreshQualificationList({ month }), onSettled: refresh }),
    setAutoIssue: useMutation({
      mutationFn: (enabled: boolean) => updateTenantSettings({ autoIssueGatePasses: enabled }),
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['tenant'] }),
    }),
  }
}
