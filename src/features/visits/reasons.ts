import { strings } from '@/lib/strings'
import type { EligibilityResult } from '@/types/penalties'

const r = strings.visits.reasons

const untilLabel = (endDate: number | null): string | null => (endDate === null ? null : new Date(endDate).toLocaleDateString())

/**
 * The reasons a vehicle was refused, in words. Everything comes straight from the shared `checkEligibility` output
 * (documents, penalties, inspection clearance); nothing is re-derived here. Never includes a penalty's reason, issuer or
 * photo: the output does not carry them.
 */
export function deniedReasons(e: EligibilityResult, opts: { ignoreInspection?: boolean } = {}): string[] {
  const out: string[] = []
  if (e.vehicle?.documentStatus === 'expired') out.push(r.vehicleDocs)
  if (e.driver?.documentStatus === 'expired') out.push(r.driverDocs)
  if (e.vehicle?.annualInspection === 'missing' || e.vehicle?.annualInspection === 'expired') out.push(r.annualInspection)
  const q = e.driver?.qualifications
  if (q && !q.ok) out.push(r.qualification([...q.missing, ...q.expired]))
  for (const p of e.vehicle?.penalties ?? []) out.push(r.vehiclePenalty(p.typeName, untilLabel(p.endDate)))
  for (const p of e.driver?.penalties ?? []) out.push(r.driverPenalty(p.typeName, untilLabel(p.endDate)))
  const i = e.inspection
  if (i && !i.cleared && !opts.ignoreInspection) {
    if (i.status === 'never_inspected') out.push(r.neverInspected)
    else if (i.status === 'rejected') out.push(r.rejectedInspection)
    else if (i.status === 'needs_reinspection') out.push(i.reason ? r.reinspection[i.reason] : r.reinspection.manual)
  }
  return out.length > 0 ? out : [r.generic]
}
