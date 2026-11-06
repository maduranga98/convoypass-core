import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { QualificationState } from '@/lib/requirementLogic'
import { strings } from '@/lib/strings'

const styles: Record<QualificationState, { tone: string; Icon: typeof Clock }> = {
  valid: { tone: 'bg-success-soft text-success-strong', Icon: CheckCircle2 },
  expiringSoon: { tone: 'bg-accent-soft text-ink', Icon: Clock },
  expired: { tone: 'bg-danger-soft text-danger-strong', Icon: AlertTriangle },
  missing: { tone: 'bg-danger-soft text-danger-strong', Icon: CircleDashed },
}

/** Status of one qualification. The word and an icon always accompany the colour. */
export function QualificationBadge({ state }: { state: QualificationState }) {
  const { tone, Icon } = styles[state]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      <Icon aria-hidden className="size-3.5" />
      {strings.qualifications.status[state]}
    </span>
  )
}
