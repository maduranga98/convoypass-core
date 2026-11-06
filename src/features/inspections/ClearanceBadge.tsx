import { CircleDashed, CircleX, RotateCcw, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Clearance, ClearanceStatus } from '@/lib/inspectionLogic'
import { strings } from '@/lib/strings'

const t = strings.inspections

const styles: Record<ClearanceStatus, { tone: string; Icon: typeof ShieldCheck }> = {
  cleared: { tone: 'bg-success-soft text-success-strong', Icon: ShieldCheck },
  needs_reinspection: { tone: 'bg-accent-soft text-ink', Icon: RotateCcw },
  rejected: { tone: 'bg-danger-soft text-danger-strong', Icon: CircleX },
  never_inspected: { tone: 'bg-slate-100 text-slate-700', Icon: CircleDashed },
}

/**
 * Inspection clearance of a vehicle. The word and an icon always accompany the colour. "Needs re-inspection" names its
 * reason: beside the badge with `showReason`, and in the tooltip.
 */
export function ClearanceBadge({ clearance, showReason = false }: { clearance: Clearance; showReason?: boolean }) {
  const { tone, Icon } = styles[clearance.status]
  const reason = clearance.status === 'needs_reinspection' && clearance.reason ? t.reason[clearance.reason] : null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span title={reason ?? undefined} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
        <Icon aria-hidden className="size-3.5" />
        {t.clearance[clearance.status]}
      </span>
      {showReason && reason && <span className="text-xs text-slate-600">{reason}</span>}
    </span>
  )
}
