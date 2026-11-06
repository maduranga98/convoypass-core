import { ArrowRight, CalendarX2, CheckCheck, CheckCircle2, Clock, Inbox, ListChecks, SearchX, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { slaOf } from '@/lib/defaultSla'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { BulkResultsDialog } from '@/features/passes/BulkResultsDialog'
import { isBulkSelectable, useBulkSelection } from '@/features/passes/bulk'
import { timeAgo } from '@/features/passes/passView'
import { useRejectionReasons, useTenant } from '@/features/passes/queries'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useDecisions } from '@/features/passes/useDecisions'
import { QUEUE_LIMIT, usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import { useContractorList } from '@/features/shared/queries'
import type { BulkItemResult, PassStatus, PassWithId } from '@/types/passes'
import { PassTable } from './PassTable'
import { ReviewPanel } from './ReviewPanel'
import { isOfficerOverdue, oldestWaitingFirst, waitingSince } from './queue'

const t = strings.officer
const a = strings.approvals

type Tab = 'awaiting' | 'approved' | 'rejected' | 'expired'
const TABS: readonly Tab[] = ['awaiting', 'approved', 'rejected', 'expired']
const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab)

const EMPTY: Record<Tab, { title: string; body: string }> = {
  awaiting: { title: t.emptyAwaiting, body: t.emptyAwaitingBody },
  approved: { title: t.emptyApproved, body: t.emptyApprovedBody },
  rejected: { title: t.emptyRejected, body: t.emptyRejectedBody },
  expired: { title: t.emptyExpired, body: t.emptyExpiredBody },
}

const APPROVED: PassStatus[] = ['officer_approved', 'checked_in']
const PENDING: PassStatus[] = ['submitted', 'supervisor_approved']

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
const capped = (n: number): string | number => (n >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : n)

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A stat tile that switches the list to its tab. */
function StatTile({ icon, label, short, value, tone, active, onClick }: { icon: ReactNode; label: string; short: string; value: ReactNode; tone: 'success' | 'danger' | 'neutral'; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-w-0 flex-col items-start gap-2 rounded-xl border bg-surface p-3 text-left shadow-sm transition-colors sm:flex-row sm:items-center sm:gap-3 sm:p-4',
        active ? 'border-brand ring-1 ring-brand' : 'border-slate-200 hover:border-slate-300',
        focusRing,
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5',
          tone === 'success' ? 'bg-success-soft text-success-strong' : tone === 'danger' ? 'bg-danger-soft text-danger-strong' : 'bg-slate-100 text-slate-700',
        )}
      >
        {icon}
      </span>
      <span className="w-full min-w-0">
        <span className="block text-2xl font-bold tabular-nums leading-tight tracking-tight">{value}</span>
        <span className="block truncate text-sm text-slate-600"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></span>
      </span>
    </button>
  )
}

export default function OfficerQueue() {
  const { claims, profile } = useSession()
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'awaiting'
  const openId = params.get('pass')
  const today = useToday()
  const now = useNow()
  const decisions = useDecisions()
  const reasons = useRejectionReasons(claims.tenantId)
  const target = slaOf(useTenant(claims.tenantId).data).officerMinutes
  const contractors = useContractorList('admin') // the tenant-wide list; officers may read every contractor
  const [contractorId, setContractorId] = useState('')
  const [search, setSearch] = useState('')

  // Every tab keeps a live listener so its badge count is always current.
  const on = today !== null
  const day = today ? { dateKey: today } : {}
  const queues = {
    awaiting: usePassQueue({ scope: 'officer', status: 'supervisor_approved', ...day, enabled: on }),
    approved: usePassQueue({ scope: 'officer', status: APPROVED, ...day, enabled: on }),
    rejected: usePassQueue({ scope: 'officer', status: 'rejected', ...day, enabled: on }),
    expired: usePassQueue({ scope: 'officer', status: PENDING, ...(today ? { before: today } : {}), enabled: on }),
  }
  const queue = queues[tab]

  const nameOf = useCallback(
    (id: string) => contractors.data?.find((c) => c.id === id)?.name ?? strings.common.none,
    [contractors.data],
  )
  const keep = useCallback((p: PassWithId) => (contractorId === '' || p.contractorId === contractorId) && !decisions.isHidden(p), [contractorId, decisions])
  const needle = plain(search.trim())
  const matches = useCallback(
    (p: PassWithId) => !needle || [p.plateNo, p.driverName, nameOf(p.contractorId)].some((s) => plain(s).includes(needle)),
    [needle, nameOf],
  )
  // Awaiting me is worked longest waiting first (since the supervisor approved); the other lists stay newest first.
  const awaiting = useMemo(() => oldestWaitingFirst(queues.awaiting.items.filter(keep)), [queues.awaiting.items, keep])
  const filtered = useMemo(() => (tab === 'awaiting' ? awaiting : queue.items.filter(keep)), [tab, awaiting, queue.items, keep])
  const rows = useMemo(() => filtered.filter(matches), [filtered, matches])
  const count = (id: Tab) => (id === 'awaiting' ? awaiting.length : queues[id].items.filter(keep).length)
  const overdueOf = useCallback((p: PassWithId) => isOfficerOverdue(p, now, target), [now, target])
  const overdueCount = awaiting.filter(overdueOf).length
  const oldest = awaiting[0]

  const sel = useBulkSelection(awaiting, today)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ results: BulkItemResult[]; passes: PassWithId[] } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<PassWithId | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const selectingAllowed = tab === 'awaiting'
  useEffect(() => {
    if (!selectingAllowed && (sel.selected.size > 0 || sel.active)) sel.exit()
  }, [selectingAllowed, sel])

  const setParam = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  const setTab = (next: Tab) => setParam({ tab: next === 'awaiting' ? null : next, pass: null })
  const hrefOf = (p: PassWithId) => {
    const next = new URLSearchParams(params)
    next.set('pass', p.id)
    return `?${next.toString()}`
  }

  // ---- the open pass ----
  // The panel keeps showing a pass whose decision is in flight (it is already hidden from the table).
  const open = queue.items.find((p) => p.id === openId)
  const openIndex = rows.findIndex((p) => p.id === openId)
  const go = (index: number) => {
    const target = rows[index]
    if (target) setParam({ pass: target.id })
  }
  const closePanel = () => setParam({ pass: null })
  // After a decision the pass leaves the list: the next one takes its place, or the panel closes.
  const afterDecision = () => {
    const next = rows[openIndex + 1] ?? rows[openIndex - 1]
    setParam({ pass: next ? next.id : null })
  }
  // A pass that left this list altogether (decided elsewhere, wrong tab in a shared link) has nothing to show.
  const gone = Boolean(openId) && !queue.isLoading && !queue.items.some((p) => p.id === openId)
  useEffect(() => {
    if (gone) setParam({ pass: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone])

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

  const startRevoke = (p: PassWithId) => {
    setRevokeError(null)
    setRevokeTarget(p)
  }
  const confirmRevoke = async (choice: RejectChoice) => {
    if (!revokeTarget) return
    setSending(true)
    setRevokeError(null)
    const res = await decisions.revoke(revokeTarget, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok' || res.outcome === 'changed') setRevokeTarget(null)
    else setRevokeError(res.message ?? strings.common.somethingWrong)
  }

  const isPickable = useCallback((p: PassWithId) => today !== null && isBulkSelectable(p, today), [today])
  const pickableCount = awaiting.filter(isPickable).length
  const loadingAwaiting = !today || (queues.awaiting.isLoading && queues.awaiting.items.length === 0)
  const tileValue = (id: Tab): ReactNode =>
    !today || (queues[id].isLoading && queues[id].items.length === 0) ? <Skeleton className="h-8 w-10" /> : capped(count(id))
  const dateLine = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const filtering = contractorId !== '' || needle !== ''

  return (
    <div className={cn('mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8', open && 'lg:mr-[34rem] lg:max-w-none')}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-600">{dateLine}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
        </div>
        <p className="hidden text-sm text-slate-600 sm:block">{strings.home.welcome(profile.name)}</p>
      </header>

      {/* The queue: the one thing an officer opens the app for. */}
      <section aria-labelledby="officer-queue-summary" className="overflow-hidden rounded-2xl bg-brand text-on-solid shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 id="officer-queue-summary" className="text-sm font-semibold text-slate-300">{t.hero.title}</h2>
            <p className="mt-1 flex items-baseline gap-3">
              <span className="text-5xl font-extrabold tabular-nums tracking-tight">{loadingAwaiting ? strings.common.none : capped(awaiting.length)}</span>
              <span aria-live="polite" className="text-base font-medium">{loadingAwaiting ? strings.common.loading : t.hero.waiting(awaiting.length)}</span>
            </p>
            {!loadingAwaiting && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {oldest ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <Clock aria-hidden className="size-4" />
                    {t.hero.oldest(timeAgo(waitingSince(oldest), now).toLowerCase())}
                  </span>
                ) : (
                  <span className="text-slate-300">{t.hero.allClear}</span>
                )}
                {overdueCount > 0 && <span className="rounded-full bg-accent px-2.5 py-0.5 font-bold text-ink">{t.hero.overdue(overdueCount)}</span>}
                {contractorId && <span className="text-slate-300">· {nameOf(contractorId)}</span>}
              </div>
            )}
          </div>
          {oldest && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setParam({ tab: null, pass: oldest.id })
              }}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-base font-bold text-ink hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
            >
              {t.hero.reviewNext}
              <ArrowRight aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <StatTile tone="success" icon={<CheckCircle2 aria-hidden />} label={t.tabs.approved} short={t.tiles.approved} value={tileValue('approved')} active={tab === 'approved'} onClick={() => setTab('approved')} />
        <StatTile tone="danger" icon={<XCircle aria-hidden />} label={t.tabs.rejected} short={t.tiles.rejected} value={tileValue('rejected')} active={tab === 'rejected'} onClick={() => setTab('rejected')} />
        <StatTile tone="neutral" icon={<CalendarX2 aria-hidden />} label={t.tabs.expired} short={t.tiles.expired} value={tileValue('expired')} active={tab === 'expired'} onClick={() => setTab('expired')} />
      </div>

      <section aria-label={t.listLabel} className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="tablist" aria-label={t.tabsLabel} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1 sm:grid-cols-4 xl:w-auto">
            {TABS.map((id) => {
              const n = count(id)
              return (
                <button
                  key={id}
                  role="tab"
                  id={`officer-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="officer-panel"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    tab === id ? 'bg-surface text-ink shadow-sm' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {t.tabs[id]}
                  <span
                    aria-label={`${n}`}
                    className={cn('min-w-5 rounded-full px-1.5 text-center text-xs font-bold leading-5', id === 'awaiting' && n > 0 ? 'bg-accent text-ink' : 'bg-slate-100 text-slate-700')}
                  >
                    {capped(n)}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchField label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-64 sm:flex-none" />
            <label htmlFor="contractor-filter" className="sr-only">{t.contractor}</label>
            <select
              id="contractor-filter"
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-focus sm:w-56"
            >
              <option value="">{t.allContractors}</option>
              {(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectingAllowed && pickableCount > 0 && (
              <Button
                variant={sel.active ? 'secondary' : 'primary'}
                icon={<ListChecks aria-hidden className="size-4" />}
                onClick={sel.active ? sel.exit : sel.enter}
                className="lg:hidden"
              >
                {sel.active ? a.bulk.done : a.bulk.select}
              </Button>
            )}
          </div>
        </div>

        <div id="officer-panel" role="tabpanel" aria-labelledby={`officer-tab-${tab}`} className="space-y-3">
          {tab === 'awaiting' && awaiting.length > 0 &&
            (overdueCount > 0 ? (
              <NotificationBanner tone="warning">{t.overdueNote(overdueCount, target)}</NotificationBanner>
            ) : (
              <p className="text-sm text-slate-600">{t.oldestFirst}</p>
            ))}
          {tab === 'expired' && rows.length > 0 && <NotificationBanner tone="info" role="note">{t.expiredNote}</NotificationBanner>}
          {tab === 'approved' && rows.length > 0 && <p className="text-sm text-slate-600">{t.revokeNote}</p>}

          {selectingAllowed && sel.selected.size > 0 && (
            <div className="sticky top-16 z-10 hidden items-center gap-3 rounded-xl border border-brand bg-surface px-4 py-2.5 shadow-lg lg:top-4 lg:flex">
              <p aria-live="polite" className="flex-1 text-sm font-semibold">{a.bulk.selectedCount(sel.selected.size)}</p>
              <Button variant="ghost" size="sm" onClick={sel.clear}>{a.bulk.clear}</Button>
              <Button className="bg-success-strong font-bold hover:bg-success-hover" onClick={() => setConfirming(true)}>{t.approveSelected(sel.selected.size)}</Button>
            </div>
          )}

          {queue.isError && queue.items.length === 0 ? (
            <ErrorState message={a.queue.loadFailed} error={queue.error} onRetry={queue.retry} />
          ) : queue.isLoading || !today ? (
            <ListSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-surface shadow-sm">
              {filtering && queue.items.some((p) => !decisions.isHidden(p)) ? (
                <EmptyState icon={<SearchX aria-hidden />} title={t.noMatch} />
              ) : (
                <EmptyState icon={tab === 'awaiting' ? <CheckCheck aria-hidden /> : <Inbox aria-hidden />} title={EMPTY[tab].title} body={EMPTY[tab].body} />
              )}
            </div>
          ) : (
            <>
              {queue.isError && <NotificationBanner tone="warning" role="alert">{a.queue.loadFailed}</NotificationBanner>}
              <PassTable
                rows={rows}
                now={now}
                today={today}
                contractorName={nameOf}
                openId={openId}
                onOpen={(p) => setParam({ pass: p.id })}
                hrefOf={hrefOf}
                isOverdue={overdueOf}
                selectable={selectingAllowed}
                selectMode={sel.active}
                isSelectable={isPickable}
                selected={sel.selected}
                onToggle={sel.toggle}
                onSelectAll={sel.selectAll}
                onClear={sel.clear}
                revocable={tab === 'approved'}
                onRevoke={startRevoke}
                showStatus={tab !== 'awaiting'}
                compact={Boolean(open)}
              />
              {queue.capped && <p role="status" className="text-center text-sm text-slate-600">{a.queue.capNotice}</p>}
            </>
          )}
        </div>

        {/* Phones and tablets: select mode bar above the bottom tabs. */}
        {selectingAllowed && sel.active && (
          <div className="sticky bottom-20 z-10 rounded-xl border border-brand bg-surface p-3 shadow-lg lg:hidden">
            <p aria-live="polite" className="pb-2 text-sm font-semibold">{a.bulk.selectedCount(sel.selected.size)}</p>
            <div className="flex gap-2">
              {sel.selected.size > 0 ? (
                <Button variant="secondary" className="flex-1" onClick={sel.clear}>{a.bulk.clear}</Button>
              ) : (
                <Button variant="secondary" className="flex-1" onClick={sel.selectAll}>{`${strings.common.all} (${pickableCount})`}</Button>
              )}
              <Button className="flex-[1.4] bg-success-strong font-bold hover:bg-success-hover" disabled={sel.selected.size === 0} onClick={() => setConfirming(true)}>
                {a.bulk.approveN(sel.selected.size)}
              </Button>
            </div>
          </div>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-40 bg-surface lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[34rem] lg:border-l lg:border-slate-200 lg:shadow-2xl print:hidden">
          <ReviewPanel
            key={open.id}
            pass={open}
            today={today}
            contractorName={nameOf(open.contractorId)}
            reasons={reasons}
            decisions={decisions}
            position={{ index: openIndex, total: rows.length }}
            onNext={() => go(openIndex + 1)}
            onPrevious={() => go(openIndex - 1)}
            onClose={closePanel}
            onDecided={afterDecision}
            onRevoke={startRevoke}
            suspendShortcuts={confirming || revokeTarget !== null || results !== null}
          />
        </div>
      )}

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
      <RejectSheet
        open={revokeTarget !== null}
        mode="revoke"
        reasons={reasons}
        loading={sending}
        error={revokeError}
        onConfirm={(c) => void confirmRevoke(c)}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
