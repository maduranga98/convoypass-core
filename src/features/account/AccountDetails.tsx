import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { useSession } from '@/features/auth/useAuth'
import { formatPhone } from '@/lib/credentials'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'

const t = strings.account

/** Read-only facts about the signed-in user. Staff see their email, drivers their phone number. */
export function AccountDetails() {
  const { claims, profile } = useSession()
  const contractorId = claims.contractorId
  // Supervisors and drivers may read their own contractor document (and only that one).
  const contractor = useQuery({
    queryKey: ['contractor-name', contractorId],
    enabled: Boolean(contractorId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'contractors', contractorId as string))
      return (snap.data() as { name?: string } | undefined)?.name ?? null
    },
  })

  const rows: [string, string | null][] = [
    [t.name, profile.name],
    [t.role, strings.roles[claims.role]],
    ...(contractorId ? ([[t.contractor, contractor.data ?? (contractor.isLoading ? strings.common.loading : strings.common.none)]] as [string, string][]) : []),
    claims.role === 'driver' ? [t.phone, profile.phone ? formatPhone(profile.phone) : strings.common.none] : [t.email, profile.email ?? strings.common.none],
  ]
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
