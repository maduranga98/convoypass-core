import { ClipboardCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { formatDateTime } from '@/features/penalties/model'
import { useTenantTimezone } from '@/features/penalties/queries'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList } from '@/features/shared/queries'
import { strings } from '@/lib/strings'
import type { Vehicle, WithId } from '@/types'
import { ClearanceBadge } from './ClearanceBadge'
import { clearanceOfVehicle, reinspectionReason } from './model'
import { useReinspectionVehicles } from './queries'

const t = strings.inspections.list

/** Vehicles that need another look, longest waiting first: clearance cancelled (with the reason) or last inspection rejected. */
export default function ReinspectionPage() {
  const navigate = useNavigate()
  const vehicles = useReinspectionVehicles()
  const contractors = useContractorList('admin')
  const tz = useTenantTimezone()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('')

  const names = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const items = useMemo(() => vehicles.data ?? [], [vehicles.data])
  const filtered = useMemo(
    () =>
      items.filter(
        (v) =>
          (!show || v.clearance?.status === show) &&
          matchesSearch(`${v.plateNo} ${v.plateKey} ${names.get(v.contractorId) ?? ''} ${reinspectionReason(clearanceOfVehicle(v))}`, search),
      ),
    [items, show, search, names],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)

  const columns: Column<WithId<Vehicle>>[] = [
    { key: 'plate', header: t.columns.plate, primary: true, cell: (v) => <span className="font-mono text-base font-semibold tracking-wide text-ink">{v.plateNo}</span> },
    { key: 'contractor', header: t.columns.contractor, cell: (v) => names.get(v.contractorId) ?? strings.common.none },
    {
      key: 'reason',
      header: t.columns.reason,
      cell: (v) => (
        <span className="flex flex-col items-end gap-1 md:items-start">
          <ClearanceBadge clearance={clearanceOfVehicle(v)} />
          <span className="text-xs text-slate-600">{reinspectionReason(clearanceOfVehicle(v))}</span>
        </span>
      ),
    },
    { key: 'since', header: t.columns.since, cell: (v) => (v.clearance ? formatDateTime(Timestamp.fromMillis(v.clearance.at), tz) : strings.common.none) },
  ]
  const actions = (v: WithId<Vehicle>) => (
    <Button variant="secondary" size="sm" aria-label={t.inspectLabel(v.plateNo)} onClick={() => navigate(`/safety/inspections/new?vehicle=${encodeURIComponent(v.id)}`)}>
      {t.inspect}
    </Button>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.subtitle}</p>
      </div>

      {vehicles.isPending || contractors.isPending ? (
        <ListSkeleton />
      ) : vehicles.isError || contractors.isError ? (
        <ErrorState error={vehicles.error ?? contractors.error} onRetry={() => void Promise.all([vehicles.refetch(), contractors.refetch()])} />
      ) : items.length === 0 ? (
        <EmptyState icon={<ClipboardCheck aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label={t.searchLabel} placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
            <FilterSelect label={t.filterLabel} value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="">{t.filterAll}</option>
              <option value="needs_reinspection">{strings.inspections.clearance.needs_reinspection}</option>
              <option value="rejected">{strings.inspections.clearance.rejected}</option>
            </FilterSelect>
            <p className="ml-auto text-sm text-slate-600" aria-live="polite">
              {t.count(filtered.length)}
            </p>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              title={strings.list.noMatchTitle}
              body={strings.list.noMatchBody}
              action={<ClearFilters onClick={() => { setSearch(''); setShow('') }} />}
            />
          ) : (
            <>
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(v) => v.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
