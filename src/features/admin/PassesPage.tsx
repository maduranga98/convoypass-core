import { ClipboardList } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { DataTable } from '@/components/ui/DataTable'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { dateKey as dayKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { CheckInBlock, PassHistory } from '@/features/passes/PassHistory'
import { PassReview } from '@/features/passes/PassReview'
import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { displayStatus, formatTime, issueCount, timeAgo, toMs, type DisplayStatus } from '@/features/passes/passView'
import { useRejectionReasons, useTenant } from '@/features/passes/queries'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useDecisions } from '@/features/passes/useDecisions'
import { usePass } from '@/features/passes/usePass'
import { usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import { useContractorList } from '@/features/shared/queries'
import { vehicleHistoryLink } from '@/features/reports/filters'
import type { PassWithId } from '@/types/passes'

const t = strings.admin.passes

/** `2026-03-10` (date input) <-> `20260310` (dateKey). */
const toInput = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
const fromInput = (v: string): string => v.replaceAll('-', '')

const STATUS_FILTERS: DisplayStatus[] = ['submitted', 'supervisor_approved', 'officer_approved', 'checked_in', 'rejected', 'expired']

/** Read-only pass table for admins: filters, a detail drawer with the full history, and Revoke. Never approve or reject. */
function PassDrawer({ passId, today, contractorName, onClose }: { passId: string; today: string | null; contractorName: (id: string) => string; onClose: () => void }) {
  const { claims } = useSession()
  const reasons = useRejectionReasons(claims.tenantId)
  const state = usePass(passId)
  const decisions = useDecisions()
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const pass = state.status === 'ready' ? state.pass : null
  const confirm = async (choice: RejectChoice) => {
    if (!pass) return
    setSending(true)
    setError(null)
    const res = await decisions.revoke(pass, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'error') setError(res.message ?? strings.common.somethingWrong)
    else setRevoking(false)
  }

  return (
    <Modal open onClose={onClose} title={t.drawerTitle} variant="drawer">
      {state.status === 'loading' ? (
        <ListSkeleton rows={3} />
      ) : state.status === 'error' || state.status === 'missing' ? (
        <ErrorState message={t.loadFailed} />
      ) : (
        <div className="space-y-6">
          <PassReview pass={state.pass} today={today} contractorName={contractorName(state.pass.contractorId)} {...(today ? { historyHref: vehicleHistoryLink('admin', state.pass.vehicleId, today) } : {})} />
          <CheckInBlock pass={state.pass} />
          <PassHistory pass={state.pass} />
          {state.pass.status === 'officer_approved' ? (
            <Button variant="danger" className="w-full" onClick={() => { setError(null); setRevoking(true) }}>{t.revoke}</Button>
          ) : (
            <p className="text-sm text-slate-500">{t.revokeHint}</p>
          )}
        </div>
      )}
      <RejectSheet open={revoking} mode="revoke" reasons={reasons} loading={sending} error={error} onConfirm={(c) => void confirm(c)} onCancel={() => setRevoking(false)} />
    </Modal>
  )
}

export default function PassesPage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const today = useToday()
  const now = useNow()
  const contractors = useContractorList('admin')
  const [picked, setPicked] = useState<string | null>(null) // dateKey the admin chose; null = today
  // `?status=` and `?pass=` come from the dashboard tiles and attention list.
  const [params] = useSearchParams()
  const [status, setStatus] = useState<DisplayStatus | ''>(() => {
    const s = params.get('status')
    return s && (STATUS_FILTERS as string[]).includes(s) ? (s as DisplayStatus) : ''
  })
  const [contractorId, setContractorId] = useState('')
  const [openId, setOpenId] = useState<string | null>(() => params.get('pass'))

  const day = picked ?? today ?? dayKey(tenant.data?.timezone ?? DEFAULT_TIMEZONE)
  const queue = usePassQueue({ scope: 'admin', dateKey: day, enabled: today !== null })

  const nameOf = useCallback((id: string) => contractors.data?.find((c) => c.id === id)?.name ?? strings.common.none, [contractors.data])
  const rows = useMemo(
    () =>
      queue.items.filter(
        (p: PassWithId) => (status === '' || displayStatus(p, today) === status) && (contractorId === '' || p.contractorId === contractorId),
      ),
    [queue.items, status, contractorId, today],
  )

  const field = 'h-10 rounded-lg border border-slate-300 bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus'
  const label = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          {t.date}
          <input type="date" value={toInput(day)} onChange={(e) => e.target.value && setPicked(fromInput(e.target.value))} className={field} />
        </label>
        <label className={label}>
          {t.status}
          <select value={status} onChange={(e) => setStatus(e.target.value as DisplayStatus | '')} className={field}>
            <option value="">{t.allStatuses}</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{strings.approvals.status[s]}</option>)}
          </select>
        </label>
        <label className={label}>
          {t.contractor}
          <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className={field}>
            <option value="">{t.allContractors}</option>
            {(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {!queue.isLoading && <p role="status" className="pb-2 text-sm text-slate-600">{t.count(rows.length)}</p>}
      </div>

      {queue.isError && queue.items.length === 0 ? (
        <ErrorState message={t.loadFailed} error={queue.error} onRetry={queue.retry} />
      ) : queue.isLoading ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState icon={<ClipboardList aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
        </div>
      ) : (
        <DataTable
          caption={t.title}
          rows={rows}
          rowKey={(p) => p.id}
          columns={[
            {
              key: 'plate',
              header: t.columns.plate,
              primary: true,
              cell: (p) => (
                <>
                  <button type="button" onClick={() => setOpenId(p.id)} aria-label={t.open(p.plateNo)} className="rounded font-bold tracking-tight text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    {p.plateNo}
                  </button>
                  <p className="text-xs font-normal text-slate-500">{p.vehicleType}</p>
                </>
              ),
            },
            { key: 'contractor', header: t.columns.contractor, cell: (p) => nameOf(p.contractorId) },
            { key: 'driver', header: t.columns.driver, cell: (p) => p.driverName },
            { key: 'status', header: t.columns.status, cell: (p) => <PassStatusBadge status={displayStatus(p, today)} /> },
            {
              key: 'submitted',
              header: t.columns.submitted,
              className: 'whitespace-nowrap',
              cell: (p) => <>{timeAgo(toMs(p.submittedAt), now)} <span className="text-xs text-slate-500">({formatTime(toMs(p.submittedAt))})</span></>,
            },
            {
              key: 'issues',
              header: t.columns.issues,
              cell: (p) => (issueCount(p) > 0 ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-strong">{strings.approvals.card.issues(issueCount(p))}</span> : strings.common.none),
            },
          ]}
        />
      )}
      {queue.capped && <p role="status" className="text-sm text-slate-600">{strings.approvals.queue.capNotice}</p>}

      {openId && <PassDrawer key={openId} passId={openId} today={today} contractorName={nameOf} onClose={() => setOpenId(null)} />}
    </div>
  )
}
