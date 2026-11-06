import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useNow } from '@/features/passes/useToday'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAwaitingReview, usePenaltyFeed } from './feed'
import { durationText, formatDateTime, reviewText, scopeOf, statusOf, targetText, type PenaltyRow } from './model'
import { PenaltyStatusBadge } from './PenaltyBadges'
import { PenaltyModal } from './PenaltyModal'
import { PenaltyPhoto } from './PenaltyPhoto'
import { useTenantTimezone } from './queries'

const t = strings.penalties
type Tab = 'awaiting' | 'reviewed'

/**
 * Supervisor: penalties against their contractor's vehicles and drivers. Every one is ALREADY in force. "Review" only
 * records that the supervisor has read it (with an optional note): it is a confirmation, never an approval or a rejection,
 * and the wording says so.
 */
export default function VerificationQueuePage() {
  const awaiting = useAwaitingReview()
  const all = usePenaltyFeed({ scope: 'supervisor', kind: 'all' })
  const tz = useTenantTimezone()
  const now = useNow()
  const [tab, setTab] = useState<Tab>('awaiting')
  const [openId, setOpenId] = useState<string | null>(null)

  const reviewed = all.items.filter((p) => p.verification.verifiedBy !== null)
  const rows = tab === 'awaiting' ? awaiting.waiting : reviewed
  const opened = [...awaiting.items, ...all.items].find((p) => p.id === openId) ?? null
  const loading = tab === 'awaiting' ? awaiting.isLoading : all.isLoading
  const failed = tab === 'awaiting' ? awaiting : all

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t.verify.title}</h1>
      <NotificationBanner tone="info">{t.verify.intro}</NotificationBanner>

      <div role="tablist" aria-label={t.verify.title} className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1">
        {(['awaiting', 'reviewed'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'h-9 rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:h-11',
              tab === id ? 'bg-surface text-ink shadow-sm' : 'text-slate-700',
            )}
          >
            {t.review[id]}
            {id === 'awaiting' && awaiting.waiting.length > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 text-xs font-bold text-ink">{awaiting.waiting.length}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton />
      ) : failed.isError ? (
        <ErrorState error={failed.error} onRetry={failed.retry} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck aria-hidden />}
          title={tab === 'awaiting' ? t.verify.awaitingEmpty : t.verify.reviewedEmpty}
          body={tab === 'awaiting' ? t.verify.awaitingEmptyBody : t.verify.reviewedEmptyBody}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <Card key={p.id} penalty={p} tz={tz} now={now} onOpen={() => setOpenId(p.id)} />
          ))}
        </ul>
      )}

      <PenaltyModal penalty={opened} viewer="supervisor" onClose={() => setOpenId(null)} />
    </div>
  )
}

function Card({ penalty: p, tz, now, onOpen }: { penalty: PenaltyRow; tz: string; now: number; onOpen: () => void }) {
  const kind = scopeOf(p)
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200 bg-surface p-3 sm:p-4">
      {p.evidencePhotoPath && <PenaltyPhoto path={p.evidencePhotoPath} className="size-16 shrink-0" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-ink">{targetText(p)}</span>
          <PenaltyStatusBadge status={statusOf(p, now)} />
        </div>
        <p className="text-sm text-slate-700">
          {p.typeName} · {kind === 'both' ? t.scopeBoth : kind === 'vehicle' ? t.scopeVehicle : t.scopeDriver} · {durationText(p, tz, now)}
        </p>
        <p className="text-xs text-slate-600">{t.issuedBy(p.issuedBy.name, formatDateTime(p.issuedAt, tz))}</p>
        <p className="line-clamp-2 text-sm text-slate-600">{p.reason}</p>
        {p.verification.verifiedBy !== null && <p className="text-xs text-slate-600">{reviewText(p, tz)}</p>}
      </div>
      <Button variant={p.verification.verifiedBy === null ? 'primary' : 'secondary'} size="sm" onClick={onOpen}>
        {p.verification.verifiedBy === null ? t.verify.action : t.list.view}
      </Button>
    </li>
  )
}
