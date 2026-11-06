import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { strings } from '@/lib/strings'
import type { PassWithId } from '@/types/passes'

/** The driver's pre-trip form of today, with the status it has reached (approvals, gate). */
export function PreTripBadge({ pass }: { pass: PassWithId | undefined }) {
  if (!pass) return <span className="text-sm text-slate-600">{strings.vehicles.preTrip.none}</span>
  return <PassStatusBadge status={pass.status} />
}
