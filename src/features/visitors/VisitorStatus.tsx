import { CircleDashed, Clock, DoorOpen, LogIn, TriangleAlert, Ban } from 'lucide-react'
import { cn } from '@/lib/cn'
import { visitorStrings } from '@/lib/visitorStrings'
import type { VisitorPassStatus } from '@/lib/visitorLogic'

const t = visitorStrings

const LOOK: Record<VisitorPassStatus, { Icon: typeof LogIn; tone: string }> = {
  // Same vocabulary as the rest of the app: waiting = amber, inside = green, rejected/cancelled = red outline.
  active: { Icon: CircleDashed, tone: 'bg-accent text-ink' },
  checked_in: { Icon: LogIn, tone: 'bg-success-strong text-on-solid' },
  checked_out: { Icon: DoorOpen, tone: 'bg-slate-200 text-ink' },
  expired: { Icon: Clock, tone: 'border border-slate-400 text-ink' },
  revoked: { Icon: Ban, tone: 'border-2 border-danger-strong text-danger-ink' },
}

/** A status is always a word plus an icon, never a colour alone. */
export function VisitorStatusBadge({ status }: { status: VisitorPassStatus }) {
  const { Icon, tone } = LOOK[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', tone)}>
      <Icon aria-hidden className="size-3.5" />
      {t.status[status]}
    </span>
  )
}

/** "Over time": a visitor inside longer than the pass allows. A flag only: nothing is closed or blocked. */
export function OverTimeChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-danger-strong px-2.5 py-0.5 text-xs font-bold text-danger-ink">
      <TriangleAlert aria-hidden className="size-3.5" />
      {t.overTime}
    </span>
  )
}

