import { CalendarX2, CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { BlockReason, GatePassBadgeStatus } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'

const t = strings.gatePasses

const styles: Record<GatePassBadgeStatus, { tone: string; Icon: typeof ShieldCheck }> = {
  active: { tone: 'bg-success-soft text-success-strong', Icon: ShieldCheck },
  blocked: { tone: 'bg-danger-soft text-danger-strong', Icon: ShieldAlert },
  expired: { tone: 'bg-slate-100 text-slate-700', Icon: CalendarX2 },
  not_issued: { tone: 'bg-accent-soft text-ink', Icon: CircleDashed },
}

/**
 * The monthly gate pass state. The word and an icon always accompany the colour. A blocked pass names its reason
 * ("Gate Pass: Blocked (Penalty issued)") with `showReason`, and in the tooltip.
 */
export function GatePassBadge({ status, reason = null, showReason = false, prefix = false }: { status: GatePassBadgeStatus; reason?: BlockReason | null; showReason?: boolean; prefix?: boolean }) {
  const { tone, Icon } = styles[status]
  const why = status === 'blocked' && reason ? t.reason[reason] : null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span title={why ?? undefined} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
        <Icon aria-hidden className="size-3.5" />
        {prefix ? t.line(t.status[status], showReason ? why : null) : t.status[status]}
      </span>
      {!prefix && showReason && why && <span className="text-xs text-slate-600">{why}</span>}
    </span>
  )
}
