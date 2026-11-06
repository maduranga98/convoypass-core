import { CircleCheck, CircleX } from 'lucide-react'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { describeLoadError } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/features/penalties/model'
import { useTenantTimezone } from '@/features/penalties/queries'
import type { Scope } from '@/features/shared/scope'
import type { Inspection } from '@/types/inspections'
import { HISTORY_LIMIT, useVehicleInspections } from './queries'

const t = strings.inspections

/** Chronological (newest first) list of every inspection of a vehicle: when, who, result, status and why it was cancelled. */
export function InspectionHistory({ scope, vehicleId }: { scope: Scope; vehicleId: string }) {
  const history = useVehicleInspections(scope, vehicleId)
  const tz = useTenantTimezone()
  return (
    <section aria-label={t.history.title} className="space-y-3 border-t border-slate-100 pt-5">
      <div>
        <h3 className="text-sm font-semibold">{t.history.title}</h3>
        <p className="text-xs text-slate-500">{t.history.hint}</p>
      </div>
      {history.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : history.isError ? (
        <NotificationBanner tone="error">{describeLoadError(history.error) ?? t.history.loadFailed}</NotificationBanner>
      ) : history.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">{t.history.empty}</p>
      ) : (
        <>
          <ul className="space-y-3">
            {history.data.map((i) => (
              <Entry key={i.id} inspection={i} tz={tz} />
            ))}
          </ul>
          {history.data.length >= HISTORY_LIMIT && <p className="text-xs text-slate-500">{t.history.capped}</p>}
        </>
      )}
    </section>
  )
}

export function ResultBadge({ result }: { result: Inspection['result'] }) {
  const approved = result === 'approved'
  const Icon = approved ? CircleCheck : CircleX
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', approved ? 'bg-success-soft text-success-strong' : 'bg-danger-soft text-danger-strong')}>
      <Icon aria-hidden className="size-3.5" />
      {t.result[result]}
    </span>
  )
}

function Entry({ inspection: i, tz }: { inspection: Inspection & { id: string }; tz: string }) {
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <ResultBadge result={i.result} />
          <span className={cn('text-xs font-medium', i.status === 'active' ? 'text-ink' : 'text-slate-600')}>{t.status[i.status]}</span>
        </span>
        <span className="text-xs text-slate-600">{t.history.by(i.inspectedBy.name, formatDateTime(i.inspectedAt, tz))}</span>
      </div>
      {i.status === 'invalidated' && i.invalidatedReason && (
        <p className="text-sm text-ink">{t.history.cancelledOn(t.reason[i.invalidatedReason], formatDateTime(i.invalidatedAt, tz))}</p>
      )}
      {i.status === 'superseded' && <p className="text-xs text-slate-600">{t.history.replacedBy}</p>}
      {i.invalidationNote && (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
          <span className="font-medium">{t.history.withdrawNote}: </span>
          {i.invalidationNote}
        </p>
      )}
      {i.notes && (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
          <span className="sr-only">{t.history.notes}: </span>
          {i.notes}
        </p>
      )}
    </li>
  )
}
