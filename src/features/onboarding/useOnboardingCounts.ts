import { useQuery } from '@tanstack/react-query'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { OnboardingCounts } from './model'

/** Six `count()` aggregations (no documents are read), all tenant-scoped like every other admin query. */
export function useOnboardingCounts(tenantId: string) {
  return useQuery({
    queryKey: ['onboarding-counts', tenantId],
    staleTime: 15_000,
    retry: false,
    queryFn: async (): Promise<OnboardingCounts> => {
      const n = async (name: string, ...extra: ReturnType<typeof where>[]): Promise<number> =>
        (await getCountFromServer(query(collection(db, name), where('tenantId', '==', tenantId), ...extra))).data().count
      const [contractors, supervisors, vehicles, drivers, officers, security] = await Promise.all([
        n('contractors'),
        n('users', where('role', '==', 'supervisor')),
        n('vehicles'),
        n('drivers'),
        n('users', where('role', '==', 'officer')),
        n('users', where('role', '==', 'security')),
      ])
      return { contractors, supervisors, vehicles, drivers, officers, security }
    },
  })
}
