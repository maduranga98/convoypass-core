import { Link } from 'react-router-dom'
import { useTenantTimezone } from '@/features/penalties/queries'
import type { Scope } from '@/features/shared/scope'
import { strings } from '@/lib/strings'
import { GatePassBadge } from './GatePassBadge'
import { badgeOf, currentMonthKey, monthLabel } from './model'
import { useGatePassesOf } from './queries'

const t = strings.gatePasses

interface Props {
  scope: Scope
  /** Whose passes: a vehicle's (one per assigned driver) or a driver's (one per vehicle). */
  field: 'vehicleId' | 'driverId'
  id: string
  /** The admin's overview of the month; hidden where the viewer cannot open it. */
  overviewPath?: string
}

/**
 * "Gate Pass: Active / Blocked (reason) / Expired / Not issued" for the current month, on the vehicle and driver detail
 * screens (admin, supervisor of that contractor, Safety Officer). Read only: passes are issued and reactivated by the
 * Company Admin on the Monthly passes screens.
 */
export function GatePassSection({ scope, field, id, overviewPath }: Props) {
  const tz = useTenantTimezone()
  const month = currentMonthKey(tz)
  const passes = useGatePassesOf(scope, field, id)
  const thisMonth = (passes.data ?? []).filter((p) => p.month === month)
  const { status, reason } = badgeOf(thisMonth)
  const others = field === 'vehicleId' ? thisMonth.map((p) => ({ key: p.id, name: p.driverName, p })) : thisMonth.map((p) => ({ key: p.id, name: p.plateNo, p }))

  return (
    <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={t.section.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t.section.title}</h3>
        {passes.isPending ? (
          <span className="text-xs text-slate-500" role="status">{strings.common.loading}</span>
        ) : passes.isError ? (
          <span className="text-xs text-danger-strong">{strings.common.loadFailed}</span>
        ) : (
          <GatePassBadge status={status} reason={reason} showReason prefix />
        )}
      </div>
      <p className="text-xs text-slate-500">{monthLabel(month)}</p>
      {others.length > 1 && (
        <ul className="space-y-1.5 text-sm">
          {others.map(({ key, name, p }) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <span className="truncate text-slate-700">{name}</span>
              <GatePassBadge status={p.status} reason={p.blockedReason} showReason />
            </li>
          ))}
        </ul>
      )}
      {overviewPath && (
        <Link to={overviewPath} className="text-sm font-medium text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t.nav}
        </Link>
      )}
    </section>
  )
}
