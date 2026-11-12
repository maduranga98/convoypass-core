import { Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useNow } from '@/features/passes/useToday'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { effectiveStatus, formatPassCode, isOverstay } from '@/lib/visitorLogic'
import type { WithId } from '@/types'
import type { VisitorPass } from '@/types/visitors'
import { matchesPass, type RangeFilter, type StatusFilter } from './filters'
import { isoDay, stamp, validLabel } from './format'
import { IssuePassDrawer } from './IssuePassDrawer'
import { PassDetailModal } from './PassDetailModal'
import { PlanUsage } from './PlanUsage'
import { PASS_LIST_LIMIT, useVisitorPasses } from './queries'
import { VisitorSettingsDialog } from './VisitorSettingsCard'
import { OverTimeChip, VisitorStatusBadge } from './VisitorStatus'

const t = visitorStrings

/** Admin and supervisor: every visitor pass of the company, with search, filters, the plan usage and Issue pass. */
export default function VisitorsPage({ viewer }: { viewer: 'admin' | 'supervisor' }) {
  const passes = useVisitorPasses()
  const now = useNow(30_000)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [range, setRange] = useState<RangeFilter>('all')
  const [issuing, setIssuing] = useState(false)
  const [settings, setSettings] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const all = useMemo(() => passes.data ?? [], [passes.data])
  const rows = useMemo(() => all.filter((p) => matchesPass(p, { status, range, needle: q }, now)), [all, status, range, q, now])
  const open = openId ? (all.find((p) => p.id === openId) ?? null) : null

  const columns: Column<WithId<VisitorPass>>[] = [
    {
      key: 'visitor',
      header: t.columns.visitor,
      primary: true,
      cell: (p) => (
        <button type="button" onClick={() => setOpenId(p.id)} className="text-left font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          {p.visitorName}
          {p.visitorOrganization && <span className="block text-xs font-normal text-slate-600">{p.visitorOrganization}</span>}
        </button>
      ),
    },
    { key: 'host', header: t.columns.host, cell: (p) => p.hostName ?? strings.common.none },
    { key: 'purpose', header: t.columns.purpose, cell: (p) => p.purposeOfVisit },
    { key: 'valid', header: t.columns.valid, cell: (p) => validLabel(isoDay(p.validFrom.toMillis()), isoDay(p.validUntil.toMillis())) },
    { key: 'code', header: t.columns.code, cell: (p) => <span className="font-mono tracking-wider">{formatPassCode(p.passCode)}</span> },
    {
      key: 'status',
      header: t.columns.status,
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <VisitorStatusBadge status={effectiveStatus({ status: p.status, validUntil: p.validUntil.toMillis() }, now)} />
          {isOverstay({ status: p.status, checkInAt: p.checkInAt?.toMillis() ?? null, maxDwellMinutes: p.maxDwellMinutes }, now) && <OverTimeChip />}
        </span>
      ),
    },
    { key: 'issued', header: t.columns.issued, cell: (p) => stamp(p.issuedAt.toMillis()) },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
          <p className="text-sm text-slate-600">{t.intro}</p>
        </div>
        <div className="flex gap-2">
          {viewer === 'admin' && (
            <Button variant="secondary" icon={<Settings2 aria-hidden className="size-4" />} onClick={() => setSettings(true)}>
              {t.settings.open}
            </Button>
          )}
          <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setIssuing(true)}>
            {t.issue}
          </Button>
        </div>
      </div>

      <PlanUsage />

      <div className="flex flex-wrap items-center gap-2">
        <SearchField label={t.search} placeholder={t.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} className="basis-full sm:basis-auto" />
        <FilterSelect label={strings.common.status} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">{t.statusFilter.all}</option>
          {(['active', 'checked_in', 'checked_out', 'expired', 'revoked'] as const).map((s) => (
            <option key={s} value={s}>{t.status[s]}</option>
          ))}
          <option value="over">{t.statusFilter.over}</option>
        </FilterSelect>
        <FilterSelect label={t.rangeFilter.label} value={range} onChange={(e) => setRange(e.target.value as RangeFilter)}>
          <option value="all">{t.rangeFilter.all}</option>
          <option value="today">{t.rangeFilter.today}</option>
          <option value="week">{t.rangeFilter.week}</option>
          <option value="month">{t.rangeFilter.month}</option>
        </FilterSelect>
        {passes.data && <span className="ml-auto text-sm text-slate-600">{t.count(rows.length, all.length)}</span>}
      </div>

      {passes.isError ? (
        <ErrorState message={t.loadFailed} error={passes.error} onRetry={() => void passes.refetch()} />
      ) : passes.isPending ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={all.length === 0 ? t.empty.title : t.empty.filtered} {...(all.length === 0 ? { body: t.empty.body } : {})} />
        </div>
      ) : (
        <DataTable caption={t.caption} columns={columns} rows={rows} rowKey={(p) => p.id} />
      )}
      {all.length >= PASS_LIST_LIMIT && <p role="status" className="text-sm text-slate-600">{strings.list.capNotice(PASS_LIST_LIMIT)}</p>}

      <IssuePassDrawer open={issuing} onClose={() => setIssuing(false)} />
      <PassDetailModal pass={open} now={now} onClose={() => setOpenId(null)} />
      {viewer === 'admin' && <VisitorSettingsDialog open={settings} onClose={() => setSettings(false)} />}
    </div>
  )
}
