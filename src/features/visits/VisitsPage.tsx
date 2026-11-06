import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useScope, type Scope } from '@/features/shared/scope'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'
import { useVisitList, VISIT_LIST_LIMIT } from './queries'
import { dateTime } from './time'
import { DwellChip, UnloadChip } from './VisitChips'

const t = strings.visits.list
type Filter = keyof typeof t.filter

const matches = (v: Visit, filter: Filter): boolean =>
  filter === 'all' || (filter === 'dwell' ? v.dwellWarning && v.status === 'checked_in' : v.status === filter)

/** Admin (whole company) and supervisor (own contractor): every visit, newest first, read only. Opens the timeline. */
export default function VisitsPage({ scope }: { scope: Scope }) {
  const { isAdmin } = useScope(scope)
  const visits = useVisitList(scope)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const needle = q.trim().toLowerCase()

  const rows = useMemo(
    () =>
      (visits.data ?? []).filter(
        (v) => matches(v, filter) && (needle === '' || v.plateNo.toLowerCase().includes(needle) || v.driverName.toLowerCase().includes(needle)),
      ),
    [visits.data, filter, needle],
  )
  const base = `/${isAdmin ? 'admin' : 'supervisor'}/visits`

  const columns: Column<WithId<Visit>>[] = [
    {
      key: 'vehicle',
      header: t.columns.vehicle,
      primary: true,
      cell: (v) => (
        <Link to={`${base}/${v.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
          {v.plateNo}
        </Link>
      ),
    },
    { key: 'driver', header: t.columns.driver, cell: (v) => v.driverName },
    { key: 'in', header: t.columns.checkedIn, cell: (v) => dateTime(v.checkIn.timestamp.toMillis()) },
    { key: 'unloading', header: t.columns.unloading, cell: (v) => <UnloadChip visit={v} /> },
    {
      key: 'status',
      header: t.columns.status,
      cell: (v) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge tone={v.status === 'checked_in' ? 'accent' : 'neutral'}>{strings.visits.status[v.status]}</Badge>
          {v.dwellWarning && v.status === 'checked_in' && <DwellChip />}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t.title}</h1>
          <p className="text-sm text-slate-500">{t.intro}</p>
        </div>
        <Link to={`/${isAdmin ? 'admin' : 'supervisor'}/summary`} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:h-11">
          {strings.visits.summary.title}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} className="basis-full sm:basis-auto" />
        <div role="group" aria-label={t.title} className="flex flex-wrap gap-1.5">
          {(Object.keys(t.filter) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-9 rounded-full border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:h-11',
                filter === f ? 'border-brand bg-brand text-on-solid' : 'border-slate-300 bg-surface text-ink',
              )}
            >
              {t.filter[f]}
            </button>
          ))}
        </div>
      </div>

      {visits.isError ? (
        <ErrorState message={strings.visits.loadFailed} error={visits.error} onRetry={() => void visits.refetch()} />
      ) : visits.isPending ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={q || filter !== 'all' ? strings.visits.noMatch : t.empty} {...(q || filter !== 'all' ? {} : { body: t.emptyBody })} />
        </div>
      ) : (
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(v) => v.id} />
      )}
      {(visits.data?.length ?? 0) >= VISIT_LIST_LIMIT && <NotificationBanner tone="warning">{t.capNotice(VISIT_LIST_LIMIT)}</NotificationBanner>}
    </div>
  )
}
