import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { EligibilityStatus } from '@/lib/expiry'
import { strings } from '@/lib/strings'

const styles: Record<EligibilityStatus, { tone: string; Icon: typeof Clock }> = {
  valid: { tone: 'bg-success-soft text-success-strong', Icon: CheckCircle2 },
  expiringSoon: { tone: 'bg-accent-soft text-ink', Icon: Clock },
  expired: { tone: 'bg-danger-soft text-danger-strong', Icon: AlertTriangle },
}

/** Document status. The word and an icon always accompany the colour, so meaning never depends on colour alone. */
export function EligibilityBadge({ status = 'valid' }: { status?: EligibilityStatus | undefined }) {
  const { tone, Icon } = styles[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      <Icon aria-hidden className="size-3.5" />
      {strings.eligibility[status]}
    </span>
  )
}
