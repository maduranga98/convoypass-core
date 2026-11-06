import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { kpiLink, type DashboardScope } from './links'
import type { Kpis } from './model'

const t = strings.dashboard.kpis
const TILES: (keyof Kpis)[] = ['submitted', 'waitingSupervisor', 'waitingOfficer', 'approved', 'checkedIn', 'rejected']

export function KpiTiles({ kpis, scope, today }: { kpis: Kpis | null; scope: DashboardScope; today: string | null }) {
  return (
    <section aria-label={t.title}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TILES.map((key) => {
          const href = kpiLink(scope, key, today)
          const body = (
            <>
              <span className="text-sm text-slate-600">{t[key]}</span>
              {kpis ? <span className="text-3xl font-semibold tabular-nums tracking-tight">{kpis[key]}</span> : <Skeleton className="h-9 w-12" />}
            </>
          )
          const cls = 'flex h-full flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-surface p-4'
          return (
            <li key={key}>
              {href ? (
                <Link to={href} className={`${cls} hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-focus`}>{body}</Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
