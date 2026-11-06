import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SearchField } from '@/components/ui/SearchField'
import { PageSpinner } from '@/components/ui/Spinner'
import { createWorkspace, listTenants } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { TenantRow } from '@/types/platform'
import { CredentialsCard, type CredentialsView } from './CredentialsCard'
import { NewWorkspaceForm, type NewWorkspaceValues } from './NewWorkspaceForm'
import { WORKSPACES_KEY } from './queryKeys'
import { ReauthCancelled } from './reauth'
import { useReauthRetry } from './useReauthRetry'
import { useSensitiveState } from './sensitive'

const t = strings.platform.workspaces

/** Workspaces: name, created, timezone, admin counts, "Not signed in yet", user and vehicle counts. Nothing else about a workspace. */
export default function WorkspacesPage() {
  const qc = useQueryClient()
  const { run, dialog } = useReauthRetry()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  // The temporary password exists only in this state: dropped on "I've shared it" or when the page is left.
  const [creds, setCreds] = useState<CredentialsView | null>(null)
  useSensitiveState(() => setCreds(null))

  const q = useInfiniteQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: ({ pageParam }) => listTenants(pageParam ? { cursor: pageParam } : {}),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  })
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.tenants) ?? [], [q.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return all
    return all.filter((r) => [r.name, r.adminName, r.adminEmail].some((v) => v?.toLowerCase().includes(needle)))
  }, [all, search])

  const create = async (v: NewWorkspaceValues) => {
    try {
      const res = await run(() => createWorkspace(v))
      setCreds({ company: v.companyName, loginUrl: res.loginUrl, email: v.adminEmail, tempPassword: res.tempPassword })
      setCreating(false)
      void qc.invalidateQueries({ queryKey: WORKSPACES_KEY })
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error(apiErrorMessage(e))
    }
  }

  const columns: Column<TenantRow>[] = [
    {
      key: 'name',
      header: t.columns.name,
      primary: true,
      cell: (r) => (
        <>
          <Link className="font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus" to={`/platform/workspaces/${encodeURIComponent(r.tenantId)}`}>{r.name}</Link>
          {!r.adminSignedIn && <span className="ml-2 align-middle"><Badge tone="neutral">{t.notSignedIn}</Badge></span>}
        </>
      ),
    },
    { key: 'created', header: t.columns.created, cell: (r) => format(new Date(r.createdAt), 'd MMM yyyy') },
    { key: 'tz', header: t.columns.timezone, cell: (r) => r.timezone },
    { key: 'admins', header: t.columns.admins, className: 'tabular-nums', cell: (r) => t.adminsCount(r.activeAdminCount, r.adminCount) },
    { key: 'users', header: t.columns.users, className: 'tabular-nums', cell: (r) => r.userCount },
    { key: 'vehicles', header: t.columns.vehicles, className: 'tabular-nums', cell: (r) => r.vehicleCount },
  ]

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
        </div>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)} disabled={creating || creds !== null}>{t.newButton}</Button>
      </header>

      {creds && <CredentialsCard view={creds} onConfirm={() => setCreds(null)} />}
      {creating && <NewWorkspaceForm onSubmit={create} onCancel={() => setCreating(false)} />}

      <SearchField label={t.search} placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={t.loadFailed} error={q.error} onRetry={() => void q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : rows.length === 0 ? (
        <EmptyState title={t.noMatch} />
      ) : (
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(r) => r.tenantId} />
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t.loadMore}</Button>
        </div>
      )}
      {dialog}
    </div>
  )
}
