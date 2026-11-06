import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { formatDateTime } from '@/features/penalties/model'
import { useTenantTimezone } from '@/features/penalties/queries'
import { usePaged } from '@/features/shared/list'
import { CapNotice, ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList } from '@/features/shared/queries'
import type { GatePassStatus } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'
import { AddPassAction } from './AddPassAction'
import { GatePassBadge } from './GatePassBadge'
import { BlockAction, ReactivateAction } from './PassActions'
import { countByStatus, currentMonthKey, filterPasses, monthLabel, overviewMonths, sortPasses, type PassRow } from './model'
import { MAX_PASSES, useGatePasses } from './queries'

const t = strings.gatePasses.overview
const STATUSES: GatePassStatus[] = ['active', 'blocked', 'expired']

/**
 * Company Admin: every monthly gate pass of a month (this month by default), filterable by status, with the reason a pass was
 * blocked. A blocked pass is reactivated here, never by itself, and only once the problem behind it is fixed.
 */
export default function GatePassesPage() {
  const tz = useTenantTimezone()
  const current = currentMonthKey(tz)
  const [month, setMonth] = useState<string | null>(null)
  const shown = month ?? current
  const passes = useGatePasses('admin', shown)
  const contractors = useContractorList('admin')
  const [status, setStatus] = useState<GatePassStatus | ''>('')
  const [search, setSearch] = useState('')

  const names = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const rows = useMemo(() => sortPasses(passes.data ?? []), [passes.data])
  const counts = useMemo(() => countByStatus(rows), [rows])
  const filtered = useMemo(
    () => filterPasses(rows, status, (r) => `${r.plateNo} ${r.driverName} ${names.get(r.contractorId) ?? ''}`, search),
    [rows, status, search, names],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)

  const columns: Column<PassRow>[] = [
    { key: 'plate', header: t.colPlate, primary: true, cell: (p) => <span className="font-mono text-base font-semibold tracking-wide text-ink">{p.plateNo}</span> },
    { key: 'driver', header: t.colDriver, cell: (p) => p.driverName },
    { key: 'contractor', header: t.colContractor, cell: (p) => names.get(p.contractorId) ?? strings.common.none },
    { key: 'status', header: t.colStatus, cell: (p) => <GatePassBadge status={p.status} reason={p.blockedReason} /> },
    { key: 'why', header: t.colWhy, cell: (p) => <Why pass={p} tz={tz} /> },
    { key: 'issued', header: t.colIssued, cell: (p) => <span className="text-xs text-slate-600">{t.issuedBy(p.issuedBy.name, formatDateTime(p.issuedAt, tz))}</span> },
  ]
  const actions = (p: PassRow) =>
    p.status === 'blocked' ? <ReactivateAction pass={p} currentMonth={current} /> : p.status === 'active' && p.month >= current ? <BlockAction pass={p} /> : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/gate-passes/month-end">
            <Button variant="secondary">{t.goToList}</Button>
          </Link>
          <AddPassAction month={current} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label={t.month} value={shown} onChange={(e) => { setMonth(e.target.value); setStatus('') }}>
          {overviewMonths(current).map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
              {m === current ? ` (${t.thisMonth.toLowerCase()})` : ''}
            </option>
          ))}
        </FilterSelect>
        <div role="group" aria-label={strings.gatePasses.overview.colStatus} className="flex flex-wrap gap-1.5">
          <StatusChip active={status === ''} onClick={() => setStatus('')} label={`${t.allStatuses} ${rows.length}`} />
          {STATUSES.map((s) => (
            <StatusChip key={s} active={status === s} onClick={() => setStatus(s)} label={`${strings.gatePasses.status[s]} ${counts[s]}`} />
          ))}
        </div>
      </div>

      {passes.isPending || contractors.isPending ? (
        <ListSkeleton />
      ) : passes.isError || contractors.isError ? (
        <ErrorState error={passes.error ?? contractors.error} onRetry={() => void Promise.all([passes.refetch(), contractors.refetch()])} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
            <p className="ml-auto text-sm text-slate-600" aria-live="polite">
              {t.count(filtered.length)}
            </p>
          </div>
          <CapNotice show={rows.length >= MAX_PASSES} />
          {filtered.length === 0 ? (
            <EmptyState title={strings.list.noMatchTitle} body={t.emptyFiltered} action={<ClearFilters onClick={() => { setSearch(''); setStatus('') }} />} />
          ) : (
            <>
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(p) => p.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

function StatusChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-11 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${active ? 'border-brand bg-brand text-on-solid' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  )
}

/** Why a pass is not active, in words: the system cause, the admin's note, and when. */
function Why({ pass, tz }: { pass: PassRow; tz: string }) {
  if (pass.status === 'blocked' && pass.blockedReason) {
    return (
      <span className="flex max-w-64 flex-col gap-0.5 text-xs text-slate-700">
        <span className="font-medium">{strings.gatePasses.reason[pass.blockedReason]}</span>
        {pass.blockNote && <span>{pass.blockNote}</span>}
        <span className="text-slate-500">{strings.gatePasses.overview.blockedOn(formatDateTime(pass.blockedAt, tz))}</span>
      </span>
    )
  }
  if (pass.reactivation) {
    return (
      <span className="text-xs text-slate-600">
        {strings.gatePasses.overview.reactivatedBy(pass.reactivation.by.name, formatDateTime(pass.reactivation.at, tz))}
      </span>
    )
  }
  return <span className="text-xs text-slate-500">{pass.status === 'expired' && pass.blockedReason ? strings.gatePasses.reason[pass.blockedReason] : strings.common.none}</span>
}
