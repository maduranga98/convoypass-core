import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { PageSpinner } from '@/components/ui/Spinner'
import { createSetupInvite, listSetupInvites, revokeSetupInvite } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { InviteRow, InviteStatus } from '@/types/platform'
import { InviteResultCard, type InviteResult } from './InviteResultCard'
import { displayStatus } from './inviteStatus'
import { formatExpiry } from './share'
import { NewInviteForm, type NewInviteValues } from './NewInviteForm'
import { ReauthCancelled } from './reauth'
import { useReauthRetry } from './useReauthRetry'
import { useSensitiveState } from './sensitive'

const t = strings.platform.invites
const KEY = ['platform', 'invites'] as const

const TONE: Record<InviteStatus, 'neutral' | 'accent' | 'success' | 'danger'> = { unused: 'accent', claimed: 'neutral', used: 'success', expired: 'danger' }

export default function InvitesPage() {
  const qc = useQueryClient()
  const { run, dialog } = useReauthRetry()
  // The invite code exists ONLY in this state: not in a query or mutation cache, not in storage. Closing the card or
  // leaving the page (unmount) drops it.
  const [result, setResult] = useState<InviteResult | null>(null)
  useSensitiveState(() => setResult(null))
  const [filter, setFilter] = useState<InviteStatus | ''>('')
  const [revoking, setRevoking] = useState<InviteRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  // Keeps "expired" current while the page stays open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const list = useInfiniteQuery({
    queryKey: [...KEY, filter],
    queryFn: ({ pageParam }) => listSetupInvites({ ...(filter ? { status: filter } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  })

  const create = async (v: NewInviteValues) => {
    try {
      const invite = await run(() => createSetupInvite(v))
      setResult({ invite, company: v.companyHint, lockEmail: v.lockEmail })
      void qc.invalidateQueries({ queryKey: KEY })
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error(apiErrorMessage(e))
    }
  }

  const revoke = async () => {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      await run(() => revokeSetupInvite({ hashPrefix: revoking.hashPrefix }))
      toast.success(t.revoked)
      void qc.invalidateQueries({ queryKey: KEY })
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error(apiErrorMessage(e))
    } finally {
      setRevokeBusy(false)
      setRevoking(null)
    }
  }

  const rows = list.data?.pages.flatMap((p) => p.invites) ?? []
  const columns: Column<InviteRow>[] = [
    { key: 'company', header: t.columns.company, primary: true, cell: (r) => r.companyHint ?? <span className="text-slate-500">{t.noCompany}</span> },
    { key: 'invite', header: t.columns.invite, cell: (r) => <code className="font-mono text-xs">{r.hashPrefix}</code> },
    { key: 'lock', header: t.columns.lock, cell: (r) => r.lockEmail ?? <span className="text-slate-500">{t.noLock}</span> },
    { key: 'status', header: t.columns.status, cell: (r) => <Badge tone={TONE[displayStatus(r, now)]}>{t.status[displayStatus(r, now)]}</Badge> },
    { key: 'expires', header: t.columns.expires, cell: (r) => formatExpiry(r.expiresAt) },
    { key: 'workspace', header: t.columns.workspace, cell: (r) => r.tenantName ?? strings.common.none },
  ]

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
        <p className="mt-1 text-sm text-slate-500">{t.alternative}</p>
      </header>

      {result && <InviteResultCard result={result} onClose={() => setResult(null)} />}
      <NewInviteForm onSubmit={create} disabled={result !== null} />

      <section aria-labelledby="invites-list-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="invites-list-title" className="text-base font-semibold">{t.listHeading}</h2>
          <FilterSelect label={t.filterLabel} value={filter} onChange={(e) => setFilter(e.target.value as InviteStatus | '')}>
            <option value="">{t.allStatuses}</option>
            {(['unused', 'claimed', 'used', 'expired'] as const).map((s) => (
              <option key={s} value={s}>{t.status[s]}</option>
            ))}
          </FilterSelect>
        </div>

        {list.isPending ? (
          <PageSpinner />
        ) : list.isError ? (
          <ErrorState message={t.loadFailed} error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={filter ? t.emptyFiltered : t.empty} />
        ) : (
          <>
            <DataTable
              caption={t.listHeading}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.hashPrefix}
              actions={(r) =>
                displayStatus(r, now) === 'unused' ? (
                  <Button variant="ghost" size="sm" onClick={() => setRevoking(r)}>{t.revoke}</Button>
                ) : null
              }
            />
            {list.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t.loadMore}</Button>
              </div>
            )}
          </>
        )}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        title={t.revokeTitle}
        body={revoking ? t.revokeBody(revoking.hashPrefix) : ''}
        confirmLabel={t.revoke}
        tone="danger"
        loading={revokeBusy}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
      {dialog}
    </div>
  )
}
