import { cn } from '@/lib/cn'
import { visitorStrings } from '@/lib/visitorStrings'
import { usePlanUsage } from './queries'

const t = visitorStrings.usage

export function PlanUsage({ className }: { className?: string }) {
  const { cap, used, ready, full } = usePlanUsage()
  if (!ready) return null
  if (cap === null) return <p className={cn('text-sm text-slate-600', className)}>{t.unlimited(used)}</p>
  const pct = Math.min(100, Math.round((used / cap) * 100))
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-sm font-medium text-ink">
        {t.label(Math.min(used, cap), cap)}
        {!full && cap - used <= 5 && <span className="ml-2 font-normal text-slate-600">{t.near(cap - used)}</span>}
      </p>
      <div role="progressbar" aria-label={t.bar} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(used, cap)} className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
        <div className={cn('h-full rounded-full', full ? 'bg-danger-strong' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
      {full && <p role="status" className="text-sm font-semibold text-danger-ink">{t.full}</p>}
    </div>
  )
}
