import { ArrowLeft, ChevronLeft, ChevronRight, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { DecisionBar } from '@/features/passes/DecisionBar'
import { PassChangedBanner } from '@/features/passes/PassChangedBanner'
import { PassReview } from '@/features/passes/PassReview'
import { isExpired, timeAgo, toMs } from '@/features/passes/passView'
import { useRejectionReasons } from '@/features/passes/queries'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useReviewShortcuts } from '@/features/passes/shortcuts'
import { useDecisions } from '@/features/passes/useDecisions'
import { useReviewLock } from '@/features/passes/useReviewLock'
import { usePass } from '@/features/passes/usePass'
import { usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import type { PassWithId } from '@/types/passes'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { isOverdue, nextInQueue, oldestFirst } from './queue'
import { useSupervisorTarget } from './useSupervisorTarget'

const t = strings.supervisor.approvals
const a = strings.approvals

/** The review step for one pass. Remounted per pass id, so what the reviewer "saw" always starts fresh. */
function Review({ pass, today }: { pass: PassWithId; today: string | null }) {
  const navigate = useNavigate()
  const { search } = useLocation()
  const { claims } = useSession()
  const reasons = useRejectionReasons(claims.tenantId)
  const decisions = useDecisions()
  const now = useNow()
  const target = useSupervisorTarget()
  const pending = usePassQueue({ scope: 'supervisor', status: 'submitted', ...(today ? { dateKey: today } : {}), enabled: today !== null })

  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const busy = decisions.busyOf(pass.id)
  const lock = useReviewLock(pass, busy)
  const changed = lock.changed
  const expired = today !== null && isExpired(pass, today)
  const decidable = pass.status === 'submitted' && !expired
  const locked = changed || !decidable

  // Same order as the Pending list: longest waiting first.
  const queueIds = useMemo(() => oldestFirst(pending.items.filter((p) => !decisions.isHidden(p))).map((p) => p.id), [pending.items, decisions])
  const position = queueIds.indexOf(pass.id)
  const nextId = nextInQueue(queueIds, pass.id)
  const prevId = position > 0 ? (queueIds[position - 1] ?? null) : null
  const overdue = decidable && isOverdue(pass, now, target)
  const listPath = `/supervisor/approvals${search}`
  const open = (id: string) => void navigate(`/supervisor/approvals/${id}${search}`, { replace: true })

  const goNext = () => {
    lock.leave()
    if (nextId) open(nextId)
    else void navigate(listPath, { replace: true })
  }

  const approve = async () => {
    const res = await decisions.approve(pass)
    if (res.outcome === 'ok') goNext()
  }

  const confirmReject = async (choice: RejectChoice) => {
    setSending(true)
    setRejectError(null)
    const res = await decisions.reject(pass, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok') {
      setRejecting(false)
      goNext()
    } else if (res.outcome === 'changed') setRejecting(false)
    else setRejectError(res.message ?? strings.common.somethingWrong)
  }

  const canDecide = decidable && !locked && busy === null && !rejecting
  useReviewShortcuts(!rejecting, {
    next: () => nextId && !busy && open(nextId),
    previous: () => prevId && !busy && open(prevId),
    approve: () => canDecide && void approve(),
    reject: () => {
      if (!canDecide) return
      setRejectError(null)
      setRejecting(true)
    },
  })

  return (
    <article
      aria-label={pass.plateNo}
      className={cn('space-y-4 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-surface sm:px-6 sm:pt-5 sm:shadow-sm', !decidable && 'sm:pb-6')}
    >
      <div className={cn('flex items-center justify-between gap-3', position < 0 && 'lg:hidden')}>
        <Link to={listPath} aria-label={t.review.back} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg px-1 text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden">
          <ArrowLeft aria-hidden className="size-5" />
          {t.review.backShort}
        </Link>
        {position >= 0 && (
          <div className="ml-auto flex items-center gap-1">
            <p className="whitespace-nowrap px-1 text-sm font-medium text-slate-700">{t.review.position(position + 1, queueIds.length)}</p>
            <Button variant="ghost" size="icon" aria-label={t.review.previous} title={`${t.review.previous} (K)`} disabled={!prevId || busy !== null} onClick={() => prevId && open(prevId)}>
              <ChevronLeft aria-hidden className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t.review.next} title={`${t.review.next} (J)`} disabled={!nextId || busy !== null} onClick={() => nextId && open(nextId)}>
              <ChevronRight aria-hidden className="size-5" />
            </Button>
          </div>
        )}
      </div>

      {changed && <PassChangedBanner onAcknowledge={lock.acknowledge} />}
      {!changed && expired && <NotificationBanner tone="info" size="lg">{a.decision.expired}</NotificationBanner>}
      {!changed && !expired && !decidable && <NotificationBanner tone="info" size="lg">{t.review.alreadyDecided}</NotificationBanner>}
      {!changed && overdue && (
        <NotificationBanner tone="warning">{t.review.overdue(timeAgo(toMs(pass.submittedAt), now).toLowerCase(), target)}</NotificationBanner>
      )}
      {!changed && decidable && pass.checklist.some((c) => c.answer === 'no') && (
        <NotificationBanner tone="error" role="note" size="lg">{a.decision.issuesWarning}</NotificationBanner>
      )}

      <PassReview pass={pass} today={today} layout="wide" />

      {decidable && (
        <DecisionBar
          className="-mx-4 sm:-mx-6 sm:rounded-b-2xl sm:px-6"
          busy={busy}
          disabled={locked}
          onApprove={() => void approve()}
          onReject={() => { setRejectError(null); setRejecting(true) }}
        />
      )}

      <RejectSheet
        open={rejecting}
        reasons={reasons}
        loading={sending}
        error={rejectError}
        onConfirm={(c) => void confirmReject(c)}
        onCancel={() => setRejecting(false)}
      />
    </article>
  )
}

export default function ReviewPage() {
  const { passId = '' } = useParams()
  const state = usePass(passId)
  const today = useToday()
  const [retryKey, setRetryKey] = useState(0)

  // A block body on purpose: window.scrollTo returns a Promise in current Chrome, and React would call whatever the
  // effect returns as its cleanup ("is not a function" on the next pass).
  useEffect(() => {
    window.scrollTo?.({ top: 0 })
  }, [passId])

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">{strings.common.loading}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (state.status === 'error') return <ErrorState message={a.decision.loadFailed} onRetry={() => setRetryKey((k) => k + 1)} />
  if (state.status === 'missing') {
    return (
      <EmptyState
        icon={<SearchX aria-hidden />}
        title={a.decision.notFound}
        action={<Link to="/supervisor/approvals" className="inline-flex h-12 items-center rounded-lg border border-slate-300 bg-surface px-5 text-base font-semibold">{t.review.back}</Link>}
      />
    )
  }
  return <Review key={`${state.pass.id}-${retryKey}`} pass={state.pass} today={today} />
}
