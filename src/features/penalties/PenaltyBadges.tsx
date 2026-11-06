import { Ban, Clock, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PenaltyStatus } from '@/lib/penaltyLogic'
import { strings } from '@/lib/strings'

const t = strings.penalties

const styles: Record<PenaltyStatus, { tone: string; Icon: typeof Ban }> = {
  active: { tone: 'bg-danger-soft text-danger-strong', Icon: Ban },
  expired: { tone: 'bg-slate-100 text-slate-700', Icon: Clock },
  revoked: { tone: 'bg-slate-100 text-slate-700 line-through', Icon: Undo2 },
}

/** Penalty status. The word and an icon always accompany the colour: active (red), expired (grey), revoked (grey, struck through). */
export function PenaltyStatusBadge({ status }: { status: PenaltyStatus }) {
  const { tone, Icon } = styles[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      <Icon aria-hidden className="size-3.5" />
      {t.status[status]}
    </span>
  )
}

/** Shown on a vehicle or driver that an active penalty blocks right now. Overrides the document status. */
export function BlockedBadge({ title }: { title?: string | undefined }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-strong">
      <Ban aria-hidden className="size-3.5" />
      {t.blocked}
    </span>
  )
}
