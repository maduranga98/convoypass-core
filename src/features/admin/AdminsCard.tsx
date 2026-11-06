import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { useUsers } from './queries'

const t = strings.admin.settings

/** Read only: who the workspace's admins are. Admin accounts are created and managed by the platform super admin. */
export function AdminsCard() {
  const admins = useUsers('admin')
  return (
    <section aria-labelledby="admins-title" className="space-y-3 rounded-xl border border-slate-200 bg-surface p-5">
      <div>
        <h2 id="admins-title" className="text-lg font-semibold">{t.adminsTitle}</h2>
        <p className="text-sm text-slate-500">{t.adminsHint}</p>
      </div>
      {admins.isPending ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : admins.isError ? (
        <ErrorState message={t.adminsLoadFailed} error={admins.error} onRetry={() => void admins.refetch()} />
      ) : admins.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t.adminsEmpty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {admins.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                <p className="truncate text-sm text-slate-600">{a.email ?? strings.common.none}</p>
              </div>
              <Badge tone={a.status === 'active' ? 'success' : 'danger'}>{strings.status[a.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-slate-600">{t.adminsNote}</p>
    </section>
  )
}
