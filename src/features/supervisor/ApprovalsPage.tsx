import { CheckCheck, ClipboardCheck, ListChecks, MousePointerClick, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useMatch, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { BulkResultsDialog } from '@/features/passes/BulkResultsDialog'
import { isBulkSelectable, useBulkSelection } from '@/features/passes/bulk'
import { useDecisions } from '@/features/passes/useDecisions'
import { QUEUE_LIMIT, usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import type { BulkItemResult, PassWithId } from '@/types/passes'
import { PassRow } from './PassRow'
import { isOverdue, oldestFirst, TAB_STATUSES as STATUSES, type SupervisorTab as Tab } from './queue'
import { useSupervisorTarget } from './useSupervisorTarget'

const t = strings.supervisor.approvals
const a = strings.approvals

const TABS: readonly Tab[] = ['pending', 'approved', 'rejected']
const isTab = (v: string | null): v is Tab => v === 'pending' || v === 'approved' || v === 'rejected'

/** The line shown under an Approved/Rejected row. */
const noteFor = (tab: Tab, p: PassWithId): string | undefined => (tab === 'rejected' ? p.rejection?.reason : undefined)

const matches = (p: PassWithId, q: string): boolean => {
  if (!q) return true
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const needle = plain(q)
  return plain(p.plateNo).includes(needle) || plain(p.driverName).includes(needle)
}

/**
 * Approvals: a dense live list, with the review of the open pass beside it on desktop (`lg`) and on its own screen on
 * smaller ones. The review is the nested route `/supervisor/approvals/:passId`.
 */
export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const openId = useMatch('/supervisor/approvals/:passId')?.params.passId ?? null
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'pending'
  const today = useToday()
  const now = useNow()
  const decisions = useDecisions()
  const target = useSupervisorTarget()
  const [search, setSearch] = useState('')

  const enabled = today !== null
  const day = today ? { dateKey: today } : {}
  // All three stay live so every tab shows its count (Home reads the same listeners).
  const queues = {
    pending: usePassQueue({ scope: 'supervisor', status: STATUSES.pending, ...day, enabled }),
    approved: usePassQueue({ scope: 'supervisor', status: STATUSES.approved, ...day, enabled }),
    rejected: usePassQueue({ scope: 'supervisor', status: STATUSES.rejected, ...day, enabled }),
  }
  const queue = queues[tab]

  // Pending is worked through longest waiting first; the other tabs stay newest first.
  const pendingVisible = useMemo(() => oldestFirst(queues.pending.items.filter((p) => !decisions.isHidden(p))), [queues.pending.items, decisions])
  const all = useMemo(() => (tab === 'pending' ? pendingVisible : queue.items.filter((p) => !decisions.isHidden(p))), [tab, pendingVisible, queue.items, decisions])
  const visible = useMemo(() => all.filter((p) => matches(p, search.trim())), [all, search])
  const overdueCount = pendingVisible.filter((p) => isOverdue(p, now, target)).length
  const sel = useBulkSelection(pendingVisible, today)

  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ results: BulkItemResult[]; passes: PassWithId[] } | null>(null)

  // Select mode only exists on the Pending tab.
  useEffect(() => {
    if (tab !== 'pending' && sel.active) sel.exit()
  }, [tab, sel])

  const setTab = (next: Tab) => setParams(next === 'pending' ? {} : { tab: next }, { replace: true })
  const linkTo = (p: PassWithId) => `/supervisor/approvals/${p.id}${location.search}`

  const runBulk = async () => {
    setSending(true)
    const passes = sel.chosen
    const res = await decisions.approveMany(passes)
    setSending(false)
    setConfirming(false)
    if (res) {
      setResults({ results: res, passes })
      sel.clear()
      if (res.every((r) => r.ok)) sel.exit()
    }
  }

  const selectingNow = sel.active && tab === 'pending'
  const selectableCount = today ? pendingVisible.filter((p) => isBulkSelectable(p, today)).length : 0
  const countOf = (id: Tab) => (id === 'pending' ? pendingVisible.length : queues[id].items.filter((p) => !decisions.isHidden(p)).length)

  return (
    <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
      <section
        aria-labelledby="approvals-title"
        className={cn(
          'flex-col lg:sticky lg:top-8 lg:flex lg:max-h-[calc(100dvh-4rem)]',
          openId ? 'hidden' : 'flex',
        )}
      >
        <div className="space-y-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 id="approvals-title" className="text-2xl font-bold tracking-tight">{t.title}</h1>
            {tab === 'pending' && pendingVisible.length > 0 && (
              <Button
                variant={selectingNow ? 'secondary' : 'primary'}
                size="sm"
                icon={<ListChecks aria-hidden className="size-4" />}
                onClick={selectingNow ? sel.exit : sel.enter}
              >
                {selectingNow ? a.bulk.done : a.bulk.select}
              </Button>
            )}
          </div>

          <div role="tablist" aria-label={t.tabsLabel} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1">
            {TABS.map((id) => {
              const n = countOf(id)
              return (
                <button
                  key={id}
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="approvals-panel"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    tab === id ? 'bg-surface text-ink shadow-sm' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {t.tabs[id]}
                  <span className={cn('min-w-5 rounded-full px-1.5 text-xs font-bold leading-5', id === 'pending' && n > 0 ? 'bg-accent text-ink' : 'bg-slate-100 text-slate-700')}>
                    {n >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : n}
                  </span>
                </button>
              )
            })}
          </div>

          <SearchField label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-none!" />

          {tab === 'pending' && pendingVisible.length > 0 &&
            (overdueCount > 0 ? (
              <NotificationBanner tone="warning">{t.overdue(overdueCount, target)}</NotificationBanner>
            ) : (
              <p className="text-sm text-slate-600">{`${t.waiting(pendingVisible.length)} ${t.oldestFirst}`}</p>
            ))}
        </div>

        <div id="approvals-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          {queue.isError && queue.items.length === 0 ? (
            <ErrorState message={a.queue.loadFailed} error={queue.error} onRetry={queue.retry} />
          ) : queue.isLoading || !today ? (
            <ListSkeleton rows={5} />
          ) : all.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-surface">
              <EmptyState
                icon={tab === 'pending' ? <CheckCheck aria-hidden /> : <ClipboardCheck aria-hidden />}
                title={{ pending: t.pendingEmptyTitle, approved: t.approvedEmptyTitle, rejected: t.rejectedEmptyTitle }[tab]}
                body={{ pending: t.pendingEmptyBody, approved: t.approvedEmptyBody, rejected: t.rejectedEmptyBody }[tab]}
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-surface">
              <EmptyState icon={<SearchX aria-hidden />} title={t.noMatch} />
            </div>
          ) : (
            <div className="space-y-2">
              {queue.isError && <NotificationBanner tone="warning" role="alert">{a.queue.loadFailed}</NotificationBanner>}
              <ul aria-label={t.listLabel(t.tabs[tab])} className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface">
                {visible.map((p) => (
                  <PassRow
                    key={p.id}
                    pass={p}
                    now={now}
                    today={today}
                    to={linkTo(p)}
                    active={p.id === openId}
                    overdue={tab === 'pending' && isOverdue(p, now, target)}
                    showStatus={tab !== 'pending'}
                    note={noteFor(tab, p)}
                    selecting={selectingNow}
                    selectable={today !== null && isBulkSelectable(p, today)}
                    selected={sel.selected.has(p.id)}
                    onToggle={() => sel.toggle(p)}
                  />
                ))}
              </ul>
              {queue.capped && <p role="status" className="text-center text-sm text-slate-600">{a.queue.capNotice}</p>}
            </div>
          )}
        </div>

        {selectingNow && (
          <div className="sticky bottom-16 z-10 mt-3 rounded-xl border border-brand bg-surface p-3 shadow-lg lg:bottom-0">
            <p aria-live="polite" className="pb-2 text-sm font-semibold">{a.bulk.selectedCount(sel.selected.size)}</p>
            <div className="flex gap-2">
              {sel.selected.size > 0 ? (
                <Button variant="secondary" className="flex-1" onClick={sel.clear}>{a.bulk.clear}</Button>
              ) : (
                selectableCount > 0 && <Button variant="secondary" className="flex-1" onClick={sel.selectAll}>{`${strings.common.all} (${selectableCount})`}</Button>
              )}
              <Button
                className="flex-[1.4] bg-success-strong font-bold hover:bg-success-hover"
                disabled={sel.selected.size === 0}
                onClick={() => setConfirming(true)}
              >
                {a.bulk.approveN(sel.selected.size)}
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className={cn('min-w-0', openId ? 'block' : 'hidden lg:block')}>
        {openId ? (
          <Outlet />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-surface">
            <EmptyState icon={<MousePointerClick aria-hidden />} title={t.pickTitle} body={t.pickBody} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={a.bulk.confirmTitle(sel.selected.size)}
        body={a.bulk.confirmBody}
        confirmLabel={a.bulk.approveN(sel.selected.size)}
        loading={sending}
        onConfirm={() => void runBulk()}
        onCancel={() => !sending && setConfirming(false)}
      />
      <BulkResultsDialog results={results?.results ?? null} passes={results?.passes ?? []} onClose={() => setResults(null)} />
    </div>
  )
}
