import { Footprints, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { useNow } from '@/features/passes/useToday'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { elapsedParts, hhmm } from './format'
import { onSiteRows, type OnSiteRow } from './onSite'
import { useInsideVehicles, useInsideVisitors } from './queries'
import { OverTimeChip } from './VisitorStatus'

const t = visitorStrings.onSite
type Filter = 'all' | 'vehicle' | 'visitor' | 'over'

/**
 * Who is on site right now: vehicles (visits still checked in) and visitors (passes still checked in), one live list for the
 * admin, supervisors, the Safety Officer and the Yard Officer. Elapsed time ticks every 30 seconds; a row over its limit
 * turns red (word plus icon as well).
 */
export default function OnSitePage({ viewer }: { viewer: 'admin' | 'supervisor' | 'safety' | 'yard' }) {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const vehicles = useInsideVehicles()
  const visitors = useInsideVisitors()
  const now = useNow(30_000)
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(
    () => onSiteRows(vehicles.data ?? [], visitors.data ?? [], tenant.data, now, viewer === 'admin' || viewer === 'supervisor' ? (id) => `/${viewer}/visits/${id}` : undefined),
    [vehicles.data, visitors.data, tenant.data, now, viewer],
  )
  const shown = rows.filter((r) => filter === 'all' || (filter === 'over' ? r.over : r.kind === filter))
  const carCount = rows.filter((r) => r.kind === 'vehicle').length
  const error = vehicles.isError ? vehicles : visitors.isError ? visitors : null
  const pending = vehicles.isPending || visitors.isPending

  const columns: Column<OnSiteRow>[] = [
    {
      key: 'type',
      header: t.columns.type,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-slate-700">
          {r.kind === 'vehicle' ? <Truck aria-hidden className="size-4" /> : <Footprints aria-hidden className="size-4" />}
          {t.type[r.kind]}
        </span>
      ),
    },
    {
      key: 'who',
      header: t.columns.who,
      primary: true,
      cell: (r) => (r.href ? <Link to={r.href} className="font-semibold text-ink underline-offset-2 hover:underline">{r.name}</Link> : <span className="font-semibold text-ink">{r.name}</span>),
    },
    { key: 'detail', header: t.columns.detail, cell: (r) => r.detail || strings.common.none },
    { key: 'in', header: t.columns.in, cell: (r) => hhmm(r.checkedInAt) },
    {
      key: 'elapsed',
      header: t.columns.elapsed,
      cell: (r) => {
        const { hours, minutes } = elapsedParts(r.checkedInAt, now)
        return (
          <span className={cn('inline-flex flex-wrap items-center gap-1.5', r.over && 'font-bold text-danger-ink')}>
            {t.elapsed(hours, minutes)}
            {r.over && <OverTimeChip />}
          </span>
        )
      },
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
          <p className="text-sm text-slate-600" aria-live="polite">{t.count(carCount, rows.length - carCount)}</p>
        </div>
        <FilterSelect label={t.title} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">{t.filterAll}</option>
          <option value="vehicle">{t.filterVehicles}</option>
          <option value="visitor">{t.filterVisitors}</option>
          <option value="over">{t.filterOver}</option>
        </FilterSelect>
      </div>

      {error ? (
        <ErrorState message={t.loadFailed} error={error.error} onRetry={() => void error.refetch()} />
      ) : pending ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={rows.length === 0 ? t.empty.title : visitorStrings.empty.filtered} {...(rows.length === 0 ? { body: t.empty.body } : {})} />
        </div>
      ) : (
        <DataTable caption={t.caption} columns={columns} rows={shown} rowKey={(r) => r.key} />
      )}
    </div>
  )
}
