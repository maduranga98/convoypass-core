import { Building2, Pause, Pencil, Play, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { SearchField } from '@/components/ui/SearchField'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { strings } from '@/lib/strings'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList } from '@/features/shared/queries'
import type { Contractor, WithId } from '@/types'
import { ContractorFormModal } from './ContractorForm'
import { ContractorStatusDialog } from './ContractorStatusDialog'
import { useContractorCounts } from './useContractorCounts'

const t = strings.admin.contractors

export default function ContractorsPage() {
  const contractors = useContractorList('admin')
  const counts = useContractorCounts()
  const [formFor, setFormFor] = useState<WithId<Contractor> | 'new' | null>(null)
  const [toggling, setToggling] = useState<WithId<Contractor> | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const items = useMemo(() => contractors.data ?? [], [contractors.data])
  const filtered = useMemo(
    () =>
      items.filter(
        (c) =>
          (!status || c.status === status) &&
          matchesSearch([c.name, c.contactName ?? '', c.phone ?? '', c.address ?? ''].join(' '), search),
      ),
    [items, status, search],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)

  const columns: Column<WithId<Contractor>>[] = [
    {
      key: 'name',
      header: t.columns.name,
      primary: true,
      cell: (c) => (
        <Link
          to={`/admin/contractors/${c.id}`}
          className="inline-flex min-h-11 items-center rounded font-medium text-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {c.name}
        </Link>
      ),
    },
    { key: 'contact', header: t.columns.contact, cell: (c) => [c.contactName, c.phone].filter(Boolean).join(' · ') || strings.common.none },
    { key: 'vehicles', header: t.columns.vehicles, className: 'tabular-nums', cell: (c) => (counts.loading ? strings.common.none : (counts.vehicles.get(c.id) ?? 0)) },
    { key: 'drivers', header: t.columns.drivers, className: 'tabular-nums', cell: (c) => (counts.loading ? strings.common.none : (counts.drivers.get(c.id) ?? 0)) },
    { key: 'status', header: t.columns.status, cell: (c) => <StatusBadge status={c.status} /> },
  ]

  const actions = (c: WithId<Contractor>) => {
    const label = c.status === 'active' ? t.suspend : t.activate
    return (
      <div className="inline-flex gap-1">
        <Button variant="ghost" size="icon" title={t.edit} aria-label={`${t.edit}: ${c.name}`} onClick={() => setFormFor(c)}>
          <Pencil aria-hidden className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title={label} aria-label={`${label}: ${c.name}`} onClick={() => setToggling(c)}>
          {c.status === 'active' ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormFor('new')}>
          {t.create}
        </Button>
      </div>

      {contractors.isPending ? (
        <ListSkeleton />
      ) : contractors.isError ? (
        <ErrorState error={contractors.error} onRetry={() => void contractors.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Building2 aria-hidden />} title={t.emptyTitle} body={t.emptyBody} action={<Button onClick={() => setFormFor('new')}>{t.create}</Button>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label={t.searchLabel} placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} className="basis-full sm:basis-auto" />
            <FilterSelect label={t.statusFilter} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{strings.list.allStatuses}</option>
              <option value="active">{strings.status.active}</option>
              <option value="suspended">{strings.status.suspended}</option>
            </FilterSelect>
            <span className="ml-auto text-sm text-slate-500">{strings.list.count(filtered.length, items.length)}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              title={strings.list.noMatchTitle}
              body={strings.list.noMatchBody}
              action={
                <ClearFilters
                  onClick={() => {
                    setSearch('')
                    setStatus('')
                  }}
                />
              }
            />
          ) : (
            <>
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(c) => c.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}

      <ContractorFormModal target={formFor} onClose={() => setFormFor(null)} />
      <ContractorStatusDialog contractor={toggling} onClose={() => setToggling(null)} />
    </div>
  )
}
