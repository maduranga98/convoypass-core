import { permitState } from '@/lib/requirementLogic'
import { strings } from '@/lib/strings'
import type { Driver } from '@/types'
import { QualificationBadge } from './QualificationBadge'
import { cellsOf, useRequirementContext } from './model'

const q = strings.qualifications
const p = strings.permits

/** Read-only: the driver's qualification standing and their own permit numbers (information only). */
export function DriverRequirements({ driver }: { driver: Driver }) {
  const ctx = useRequirementContext()
  const cells = cellsOf(ctx.types, driver.qualifications, ctx.today, ctx.warningDays)
  const permits = driver.permits ?? []
  return (
    <>
      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={q.drawer.title}>
        <h3 className="text-sm font-semibold">{q.drawer.title}</h3>
        {cells.length === 0 ? (
          <p className="text-sm text-slate-500">{q.drawer.none}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {cells.map((c) => {
              const record = driver.qualifications?.[c.type.id]
              return (
                <li key={c.type.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{c.type.name}</span>
                    {record && <span className="block text-xs text-slate-500">{q.drawer.recordedBy(record.recordedByName)}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <QualificationBadge state={c.state} />
                    {c.expiresOn && <span className="font-mono text-xs text-slate-500">{q.until(c.expiresOn)}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={p.drawerTitle}>
        <h3 className="text-sm font-semibold">{p.drawerTitle}</h3>
        {permits.length === 0 ? (
          <p className="text-sm text-slate-500">{p.none}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {permits.map((permit) => {
              const state = permitState(permit, ctx.today, ctx.warningDays)
              return (
                <li key={permit.number} className="flex items-baseline justify-between gap-3">
                  <span className="font-mono font-medium text-slate-900">{permit.number}</span>
                  <span className="text-slate-600">{state === 'expired' ? p.expired(permit.expiresOn) : state === 'expiringSoon' ? p.expiringSoon(permit.expiresOn) : p.valid(permit.expiresOn)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
