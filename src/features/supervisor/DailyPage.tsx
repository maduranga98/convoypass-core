import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { formatDateKey, formatTime, toMs } from '@/features/passes/passView'
import { QUEUE_LIMIT, usePassQueue } from '@/features/passes/usePassQueue'
import { useToday } from '@/features/passes/useToday'
import type { PassWithId } from '@/types/passes'
import { APPROVED_STATUSES, dailyCounts, inputFromKey, keyFromInput } from './daily'

const t = strings.supervisor.daily

type Filter = 'all' | 'approved' | 'rejected' | 'waiting'

function Tile({ icon, label, value, tone, active, onClick }: { icon: React.ReactNode; label: string; value: number; tone: 'success' | 'danger' | 'accent' | 'neutral'; active: boolean; onClick: () => void }) {
  const toneCls = { success: 'bg-success-soft text-success-strong', danger: 'bg-danger-soft text-danger-strong', accent: 'bg-accent-soft text-ink', neutral: 'bg-slate-100 text-ink' }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-surface p-4 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        active ? 'border-brand ring-1 ring-brand' : 'border-slate-200 hover:border-slate-300',
      )}
    >
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5', toneCls)}>{icon}</span>
      <span>
        <span className="block text-3xl leading-tight font-bold tracking-tight tabular-nums">{value}</span>
        <span className="block text-sm text-slate-600">{label}</span>
      </span>
    </button>
  )
}

const matches = (p: PassWithId, f: Filter): boolean =>
  f === 'all' ? true : f === 'approved' ? APPROVED_STATUSES.includes(p.status) : f === 'rejected' ? p.status === 'rejected' : p.status === 'submitted'

/** How many vehicles the supervisor's contractor got in and how many were rejected on a day (today by default), with the vehicles behind each number. Live for the open day. */
export default function DailyPage() {
  const today = useToday()
  const [picked, setPicked] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const dateKey = picked ?? today
  const queue = usePassQueue({ scope: 'supervisor', ...(dateKey ? { dateKey } : {}), enabled: dateKey !== null })
  const counts = useMemo(() => dailyCounts(queue.items), [queue.items])
  const rows = useMemo(() => queue.items.filter((p) => matches(p, filter)), [queue.items, filter])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
          <p className="text-sm text-slate-600">{dateKey ? (dateKey === today ? t.today(formatDateKey(dateKey)) : formatDateKey(dateKey)) : strings.common.loading}</p>
        </div>
        <label className="text-sm font-medium text-slate-700">
          {t.day}
          <input
            type="date"
            value={dateKey ? inputFromKey(dateKey) : ''}
            max={today ? inputFromKey(today) : undefined}
            onChange={(e) => {
              setFilter('all')
              setPicked(e.target.value ? keyFromInput(e.target.value) : null)
            }}
            className="mt-1 block h-11 rounded-lg border border-slate-300 bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-focus"
          />
        </label>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<CheckCircle2 aria-hidden />} label={t.vehiclesIn} value={counts.approved} tone="success" active={filter === 'approved'} onClick={() => setFilter(filter === 'approved' ? 'all' : 'approved')} />
        <Tile icon={<XCircle aria-hidden />} label={t.vehiclesRejected} value={counts.rejected} tone="danger" active={filter === 'rejected'} onClick={() => setFilter(filter === 'rejected' ? 'all' : 'rejected')} />
        <Tile icon={<Clock aria-hidden />} label={t.waiting} value={counts.waiting} tone="accent" active={filter === 'waiting'} onClick={() => setFilter(filter === 'waiting' ? 'all' : 'waiting')} />
        <Tile icon={<span aria-hidden className="text-sm font-bold">Σ</span>} label={t.total} value={counts.total} tone="neutral" active={filter === 'all'} onClick={() => setFilter('all')} />
      </div>
      {counts.rejected > 0 && <p className="text-sm text-slate-600">{t.rejectedSplit(counts.rejectedBySupervisor, counts.rejected - counts.rejectedBySupervisor)}</p>}
      {queue.capped && <p className="text-sm text-slate-700">{t.capped(QUEUE_LIMIT)}</p>}

      {queue.isError && queue.items.length === 0 ? (
        <ErrorState message={t.loadFailed} error={queue.error} onRetry={queue.retry} />
      ) : queue.isLoading && queue.items.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={t.emptyTitle} body={t.emptyBody} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                to={`/supervisor/approvals/${p.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold tracking-tight">{p.plateNo}</span>
                  <span className="block truncate text-sm text-slate-600">
                    {p.driverName} · {formatTime(toMs(p.submittedAt))}
                  </span>
                  {p.status === 'rejected' && p.rejection && <span className="block truncate text-xs text-slate-700">{p.rejection.reason}</span>}
                </span>
                <PassStatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
