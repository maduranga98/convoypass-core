import { ClipboardCheck, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { formatDateTime } from '@/features/penalties/model'
import { useTenantTimezone } from '@/features/penalties/queries'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ShowMore } from '@/features/shared/ListStates'
import { apiErrorMessage } from '@/lib/errors'
import { nextMonth } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'
import type { IssueResultRow } from '@/types/gatePasses'
import { AutoIssueCard } from './AutoIssueCard'
import { currentMonthKey, entryKey, monthLabel, pruneSelection, toggleAll, toggleKey } from './model'
import { useGatePassMutations, useQualification } from './queries'

const t = strings.gatePasses.qualification

/**
 * Company Admin: the month-end qualification list. Everyone on it is eligible right now (documents, penalties, inspection)
 * and has no pass for the month. The admin reviews it and ticks who gets a pass; the server re-checks every pairing when it
 * issues. The list is stored (computed by the schedule or Refresh), so it opens instantly.
 */
export default function QualificationPage() {
  const tz = useTenantTimezone()
  const current = currentMonthKey(tz)
  const [month, setMonth] = useState<string | null>(null)
  const shown = month ?? nextMonth(current)
  const list = useQualification(shown)
  const { issue, refreshList } = useGatePassMutations()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [search, setSearch] = useState('')
  const [failed, setFailed] = useState<IssueResultRow[]>([])

  const entries = useMemo(() => list.data?.entries ?? [], [list.data])
  const filtered = useMemo(() => entries.filter((e) => matchesSearch(`${e.plateNo} ${e.driverName} ${e.contractorName}`, search)), [entries, search])
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)
  const available = useMemo(() => new Set(entries.map(entryKey)), [entries])
  // A refresh or an issue may remove rows: never keep a tick for a row that is gone.
  const live = useMemo(() => pruneSelection(selected, available), [selected, available])
  const shownKeys = useMemo(() => filtered.map(entryKey), [filtered])
  const allShown = shownKeys.length > 0 && shownKeys.every((k) => live.has(k))
  const meta = list.data?.meta ?? null

  const switchMonth = (m: string) => {
    setMonth(m)
    setSelected(new Set())
    setFailed([])
    setSearch('')
  }

  const submit = () => {
    const pairs = entries.filter((e) => live.has(entryKey(e))).map((e) => ({ vehicleId: e.vehicleId, driverId: e.driverId }))
    if (pairs.length === 0) return
    setFailed([])
    issue.mutate(
      { month: shown, pairs },
      {
        onSuccess: (res) => {
          const bad = res.results.filter((r) => !r.ok)
          setSelected(new Set())
          setFailed(bad)
          if (bad.length === 0) toast.success(t.issued(res.issued))
          else toast.warning(t.issuedSome(res.issued, bad.length))
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    )
  }

  const refresh = () =>
    refreshList.mutate(shown, {
      onSuccess: () => toast.success(t.refreshed),
      onError: (e) => toast.error(apiErrorMessage(e)),
    })

  const reasonOf = (r: IssueResultRow): string =>
    r.error !== undefined && Object.prototype.hasOwnProperty.call(strings.apiErrors, r.error) ? strings.apiErrors[r.error as keyof typeof strings.apiErrors] : strings.common.somethingWrong

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.intro}</p>
      </div>

      <AutoIssueCard />

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t.monthTabs} className="flex gap-1.5">
          {[nextMonth(current), current].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={shown === m}
              onClick={() => switchMonth(m)}
              className={`h-11 rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${shown === m ? 'border-brand bg-brand text-on-solid' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50'}`}
            >
              {m === current ? t.current : t.next}
              <span className="ml-1.5 text-xs opacity-80">{monthLabel(m)}</span>
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={refresh} loading={refreshList.isPending} className="ml-auto">
          <RefreshCw aria-hidden className="size-4" />
          {t.refresh}
        </Button>
      </div>

      {meta && (
        <p className="text-sm text-slate-600" aria-live="polite">
          {t.stats(meta.qualifiedCount, meta.alreadyIssuedCount, meta.notEligibleCount)} · {t.computedAt(formatDateTime(meta.computedAt, tz))}
        </p>
      )}
      {meta && meta.failedCount > 0 && <NotificationBanner tone="warning">{t.failedSome(meta.failedCount)}</NotificationBanner>}
      {meta?.truncated && <NotificationBanner tone="warning">{t.truncated}</NotificationBanner>}
      {failed.length > 0 && (
        <NotificationBanner tone="warning" title={t.failedRows}>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {failed.map((r) => (
              <li key={`${r.vehicleId}_${r.driverId}`}>
                {entries.find((e) => e.vehicleId === r.vehicleId && e.driverId === r.driverId)?.plateNo ?? r.vehicleId}: {reasonOf(r)}
              </li>
            ))}
          </ul>
        </NotificationBanner>
      )}

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : meta === null ? (
        <EmptyState icon={<ClipboardCheck aria-hidden />} title={t.neverComputed} body={t.intro} action={<Button onClick={refresh} loading={refreshList.isPending}>{t.refresh}</Button>} />
      ) : entries.length === 0 ? (
        <EmptyState icon={<ClipboardCheck aria-hidden />} title={t.emptyTitle} body={t.emptyBody} action={<Link to="/admin/gate-passes"><Button variant="secondary">{strings.gatePasses.nav}</Button></Link>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField label={strings.gatePasses.overview.search} placeholder={strings.gatePasses.overview.search} value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={allShown}
                onChange={() => setSelected(toggleAll(live, shownKeys))}
              />
              {t.selectAll}
            </label>
            <p className="ml-auto text-sm text-slate-600" aria-live="polite">{t.selected(live.size, entries.length)}</p>
          </div>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface" aria-label={t.title}>
            {visible.map((e) => {
              const key = entryKey(e)
              return (
                <li key={key}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50/60">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-brand"
                      checked={live.has(key)}
                      onChange={() => setSelected(toggleKey(live, key))}
                      aria-label={t.selectRow(e.plateNo, e.driverName)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-base font-semibold tracking-wide text-ink">{e.plateNo}</span>
                      <span className="block truncate text-sm text-slate-700">{e.driverName} · {e.contractorName}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${e.documentStatus === 'expiringSoon' ? 'bg-accent-soft text-ink' : 'bg-success-soft text-success-strong'}`}>
                      {e.documentStatus === 'expiringSoon' ? t.docsExpiring : t.docsValid}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}

          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-surface/95 px-4 py-3 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <p className="text-sm text-slate-700">{t.forMonth(monthLabel(shown))}</p>
              <Button onClick={submit} disabled={live.size === 0} loading={issue.isPending}>
                {issue.isPending ? t.issuing : t.issue(live.size)}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
