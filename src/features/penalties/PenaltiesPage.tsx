import { Eye, Plus, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ReinspectionCallout } from '@/features/inspections/ReinspectionCallout'
import { useNow } from '@/features/passes/useToday'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { PENALTY_STATUSES } from '@/lib/penaltyLogic'
import { strings } from '@/lib/strings'
import { usePenaltyFeed } from './feed'
import { durationText, formatDateTime, reviewText, scopeOf, statusOf, targetText, type PenaltyRow } from './model'
import { PenaltyStatusBadge } from './PenaltyBadges'
import { PenaltyModal } from './PenaltyModal'
import { useTenantTimezone } from './queries'

const t = strings.penalties

interface Props {
  /** `admin` can also revoke; the Safety Officer reads and issues. */
  viewer: 'admin' | 'safety'
  issuePath: string
}

/** Every penalty of the company, newest first, live. Status words (never colour alone) in every row. */
export default function PenaltiesPage({ viewer, issuePath }: Props) {
  const navigate = useNavigate()
  const feed = usePenaltyFeed({ scope: viewer, kind: 'all' })
  const tz = useTenantTimezone()
  const now = useNow()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(
    () => feed.items.filter((p) => (!status || statusOf(p, now) === status) && matchesSearch(`${p.targetLabels.plateNo ?? ''} ${p.targetLabels.driverName ?? ''} ${p.typeName} ${p.issuedBy.name}`, search)),
    [feed.items, status, search, now],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)
  const opened = feed.items.find((p) => p.id === openId) ?? null

  const columns: Column<PenaltyRow>[] = [
    {
      key: 'target',
      header: t.columns.target,
      primary: true,
      cell: (p) => {
        const kind = scopeOf(p)
        return (
          <span className="block min-w-0">
            <span className="block truncate font-medium text-ink">{targetText(p)}</span>
            <span className="text-xs text-slate-600">{kind === 'both' ? t.scopeBoth : kind === 'vehicle' ? t.scopeVehicle : t.scopeDriver}</span>
          </span>
        )
      },
    },
    { key: 'type', header: t.columns.type, cell: (p) => p.typeName },
    { key: 'status', header: t.columns.status, cell: (p) => <PenaltyStatusBadge status={statusOf(p, now)} /> },
    { key: 'duration', header: t.columns.duration, cell: (p) => durationText(p, tz, now) },
    {
      key: 'issued',
      header: t.columns.issued,
      cell: (p) => (
        <span className="block min-w-0">
          <span className="block truncate">{p.issuedBy.name}</span>
          <span className="text-xs text-slate-600">{formatDateTime(p.issuedAt, tz)}</span>
        </span>
      ),
    },
    { key: 'review', header: t.columns.review, cell: (p) => <span className="text-xs">{reviewText(p, tz)}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.list.title}</h1>
          <p className="text-sm text-slate-600">{t.list.subtitle}</p>
        </div>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => void navigate(issuePath)}>
          {strings.penalties.nav.issue}
        </Button>
      </div>

      {viewer === 'safety' && <ReinspectionCallout />}

      {feed.isLoading ? (
        <ListSkeleton />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={feed.retry} />
      ) : feed.items.length === 0 ? (
        <EmptyState icon={<ShieldAlert aria-hidden />} title={t.list.emptyTitle} body={t.list.emptyBody} action={<Button onClick={() => void navigate(issuePath)}>{strings.penalties.nav.issue}</Button>} />
      ) : (
        <>
          {feed.capped && <p className="text-xs text-slate-500">{t.list.capped}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <SearchField label={t.list.searchLabel} placeholder={t.list.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
            <FilterSelect label={t.statusFilter} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t.allStatuses}</option>
              {PENALTY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </FilterSelect>
            <span className="ml-auto text-xs text-slate-500">{t.list.count(filtered.length, feed.items.length)}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={strings.list.noMatchTitle} body={strings.list.noMatchBody} action={<ClearFilters onClick={() => { setSearch(''); setStatus('') }} />} />
          ) : (
            <>
              <DataTable
                caption={t.list.title}
                columns={columns}
                rows={visible}
                rowKey={(p) => p.id}
                actions={(p) => (
                  <Button variant="ghost" size="icon" title={t.list.view} aria-label={`${t.list.view}: ${targetText(p)}, ${p.typeName}`} onClick={() => setOpenId(p.id)}>
                    <Eye aria-hidden className="size-4" />
                  </Button>
                )}
              />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}

      <PenaltyModal penalty={opened} viewer={viewer} onClose={() => setOpenId(null)} />
    </div>
  )
}
