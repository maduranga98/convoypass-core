import { collection, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { liveQuery, useLiveQuery } from '@/lib/liveQuery'
import type { Role } from '@/lib/roles'
import type { Contractor, UserDoc, WithId } from '@/types'
import { useSession } from '@/features/auth/useAuth'

/** Every query is scoped by the tenant from the caller's token claims. Live: a new or edited user shows up by itself. */
export function useUsers(role: Role | '') {
  const { claims } = useSession()
  const constraints: QueryConstraint[] = [where('tenantId', '==', claims.tenantId)]
  if (role) constraints.push(where('role', '==', role))
  constraints.push(orderBy('createdAt', 'desc'))
  return useLiveQuery(
    ['users', claims.tenantId, role],
    liveQuery(query(collection(db, 'users'), ...constraints), (snap): WithId<UserDoc>[] => snap.docs.map((d) => ({ ...(d.data() as UserDoc), id: d.id }))),
  )
}

export function useContractors() {
  const { claims } = useSession()
  return useLiveQuery(
    ['contractors', claims.tenantId],
    liveQuery(
      query(collection(db, 'contractors'), where('tenantId', '==', claims.tenantId), orderBy('createdAt', 'desc')),
      (snap): WithId<Contractor>[] => snap.docs.map((d) => ({ ...(d.data() as Contractor), id: d.id })),
    ),
  )
}
