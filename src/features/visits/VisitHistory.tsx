import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Scope } from '@/features/shared/scope'
import { strings } from '@/lib/strings'
import { useSubjectVisits } from './queries'
import { dateTime } from './time'
import { DwellChip, UnloadChip } from './VisitChips'

const t = strings.visits.history

/** The latest visits of one vehicle or driver, each linking to its timeline. Embedded in the vehicle and driver drawers. */
export function VisitHistory({ scope, field, id }: { scope: Scope; field: 'vehicleId' | 'driverId'; id: string }) {
  const visits = useSubjectVisits(scope, field, id)
  return (
    <section aria-labelledby={`visits-${field}-${id}`} className="space-y-2">
      <h3 id={`visits-${field}-${id}`} className="text-sm font-semibold text-ink">{t.title}</h3>
      {visits.isError ? (
        <ErrorState message={t.loadFailed} error={visits.error} onRetry={() => void visits.refetch()} />
      ) : visits.isPending ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : visits.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t.none}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {visits.data.map((v) => (
            <li key={v.id}>
              <Link
                to={`/${scope}/visits/${v.id}`}
                aria-label={`${t.open}: ${v.plateNo}, ${dateTime(v.checkIn.timestamp.toMillis())}`}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{field === 'vehicleId' ? v.driverName : v.plateNo}</span>
                  <span className="block text-slate-600 tabular-nums">{dateTime(v.checkIn.timestamp.toMillis())}</span>
                </span>
                <UnloadChip visit={v} />
                {v.dwellWarning && v.status === 'checked_in' && <DwellChip />}
                <span className="text-xs font-medium text-slate-700">{strings.visits.status[v.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
