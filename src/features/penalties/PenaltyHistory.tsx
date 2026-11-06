import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useNow } from '@/features/passes/useToday'
import { strings } from '@/lib/strings'
import { describeLoadError } from '@/lib/errors'
import { usePenaltyFeed } from './feed'
import { durationText, formatDateTime, reviewText, scopeOf, statusOf, targetText, type PenaltyRow, type PenaltyScope } from './model'
import { PenaltyStatusBadge } from './PenaltyBadges'
import { PenaltyPhoto } from './PenaltyPhoto'
import { useTenantTimezone } from './queries'

const t = strings.penalties.history

interface Props {
  /** `supervisor` is locked to their contractor (rules); `admin` reads the company. */
  scope: PenaltyScope
  vehicleId?: string
  driverId?: string
}

/**
 * Every penalty ever issued against a vehicle or a driver: active, expired AND revoked. Past penalties are never hidden,
 * so repeat issues can be spotted. A penalty on both a driver and a vehicle shows in each one's history.
 */
export function PenaltyHistory({ scope, vehicleId, driverId }: Props) {
  const feed = usePenaltyFeed({ scope, kind: 'all', ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) })
  const tz = useTenantTimezone()
  const now = useNow()
  const subjectIsVehicle = vehicleId !== undefined

  return (
    <section aria-label={t.title} className="space-y-3 border-t border-slate-100 pt-5">
      <div>
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <p className="text-xs text-slate-500">{t.hint}</p>
      </div>
      {feed.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : feed.isError ? (
        <NotificationBanner tone="error">{describeLoadError(feed.error) ?? t.loadFailed}</NotificationBanner>
      ) : feed.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">{t.empty}</p>
      ) : (
        <>
          <ul className="space-y-3">
            {feed.items.map((p) => (
              <Entry key={p.id} penalty={p} tz={tz} now={now} subjectIsVehicle={subjectIsVehicle} />
            ))}
          </ul>
          {feed.capped && <p className="text-xs text-slate-500">{t.capped}</p>}
        </>
      )}
    </section>
  )
}

function Entry({ penalty: p, tz, now, subjectIsVehicle }: { penalty: PenaltyRow; tz: string; now: number; subjectIsVehicle: boolean }) {
  const status = statusOf(p, now)
  const kind = scopeOf(p)
  // Name the other side of a "both" penalty; a single-target penalty names its target once.
  const target = useMemo(
    () => (kind === 'both' ? `${t.both}: ${targetText(p)}` : targetText(p)),
    [kind, p],
  )
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink">{p.typeName}</span>
        <PenaltyStatusBadge status={status} />
      </div>
      <p className="text-sm text-slate-600">
        {target}
        {kind === 'both' && <span className="sr-only">{subjectIsVehicle ? strings.penalties.scopeVehicle : strings.penalties.scopeDriver}</span>}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
        <dt>{strings.penalties.detail.issuedBy}</dt>
        <dd className="text-slate-800">{strings.penalties.issuedBy(p.issuedBy.name, formatDateTime(p.issuedAt, tz))}</dd>
        <dt>{strings.penalties.detail.duration}</dt>
        <dd className="text-slate-800">{durationText(p, tz, now)}</dd>
        <dt>{strings.penalties.detail.verification}</dt>
        <dd className="text-slate-800">{reviewText(p, tz)}</dd>
      </dl>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-slate-700">
          <span className="sr-only">{t.reason}: </span>
          {p.reason}
        </p>
        {p.evidencePhotoPath && <PenaltyPhoto path={p.evidencePhotoPath} alt={t.photoAlt} className="size-16 shrink-0" />}
      </div>
    </li>
  )
}
