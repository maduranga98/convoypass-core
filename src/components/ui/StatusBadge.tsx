import { strings } from '@/lib/strings'
import { Badge } from './Badge'

export function StatusBadge({ status }: { status: 'active' | 'suspended' | 'disabled' }) {
  return <Badge tone={status === 'active' ? 'success' : 'neutral'}>{strings.status[status]}</Badge>
}
