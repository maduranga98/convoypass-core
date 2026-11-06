import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageSpinner } from '@/components/ui/Spinner'
import { getOperatorOverview } from '@/lib/api'
import { strings } from '@/lib/strings'

const t = strings.platform.overview

const linkClass =
  'inline-flex h-11 items-center rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-surface p-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export default function OverviewPage() {
  const q = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => getOperatorOverview({}), staleTime: 0 })
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <section aria-labelledby="ov-invites" className="space-y-3">
            <h2 id="ov-invites" className="text-base font-semibold">{t.invitesHeading}</h2>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label={t.unused} value={q.data.invites.unused} />
              <Tile label={t.claimed} value={q.data.invites.claimed} />
              <Tile label={t.used} value={q.data.invites.used} />
              <Tile label={t.expired} value={q.data.invites.expired} />
            </dl>
          </section>
          <section aria-labelledby="ov-tenants" className="space-y-3">
            <h2 id="ov-tenants" className="text-base font-semibold">{t.tenantsHeading}</h2>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label={t.tenants} value={q.data.tenants} />
            </dl>
          </section>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Link className={linkClass} to="/platform/workspaces">{t.newWorkspace}</Link>
        <Link className={linkClass} to="/platform/invites">{t.newInvite}</Link>
        <Link className={linkClass} to="/platform/workspaces">{t.viewWorkspaces}</Link>
      </div>
    </div>
  )
}
