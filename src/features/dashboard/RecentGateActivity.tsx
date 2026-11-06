import { DoorOpen, ShieldX } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatTime } from '@/features/passes/passView'
import { strings } from '@/lib/strings'
import type { GateActivity } from './model'

const t = strings.dashboard.recent

export function RecentGateActivity({ items, loading, contractorName }: { items: GateActivity[]; loading: boolean; contractorName: (id: string) => string }) {
  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />
  return (
    <section aria-labelledby="recent-title" className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
      <h2 id="recent-title" className="text-base font-semibold">{t.title}</h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
              {a.kind === 'checkIn' ? <DoorOpen aria-hidden className="size-4 shrink-0 text-slate-500" /> : <ShieldX aria-hidden className="size-4 shrink-0 text-danger" />}
              <span className="w-12 shrink-0 tabular-nums text-slate-500">{formatTime(a.atMs)}</span>
              <span className="font-medium">{a.plateNo}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{contractorName(a.contractorId)} · {a.gate}{a.offlineAt ? ` · ${t.unverified}` : ''}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${a.kind === 'denied' ? 'bg-danger-soft text-danger-strong' : 'bg-slate-100 text-slate-700'}`}>
                {a.kind === 'checkIn' ? t.checkIn : t.denied}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
