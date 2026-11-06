import { Badge } from '@/components/ui/Badge'
import { strings } from '@/lib/strings'
import type { DisplayStatus } from './passView'

const TONE: Record<DisplayStatus, 'neutral' | 'accent' | 'success' | 'danger'> = {
  submitted: 'accent',
  supervisor_approved: 'accent',
  officer_approved: 'success',
  checked_in: 'success',
  rejected: 'danger',
  expired: 'neutral',
}

/** Every pass status in one place, including `expired` (waiting for a reviewer, but from a previous day). */
export function PassStatusBadge({ status }: { status: DisplayStatus }) {
  return <Badge tone={TONE[status]}>{strings.approvals.status[status]}</Badge>
}
