import { dwellLimitHoursOf } from '@/lib/visitLogic'
import { isOverstay } from '@/lib/visitorLogic'
import type { Tenant, WithId } from '@/types'
import type { Visit } from '@/types/visits'
import type { VisitorPass } from '@/types/visitors'

export type OnSiteRow = {
  key: string
  kind: 'vehicle' | 'visitor'
  /** Plate or visitor name. */
  name: string
  /** Driver, or host and company. */
  detail: string
  checkedInAt: number
  /** Minutes allowed inside: the pass's own limit, or the company's gate time for a vehicle. */
  limitMinutes: number
  over: boolean
  /** Whoever the screen opens for this row. */
  href: string | null
}

/**
 * Vehicles and visitors inside right now as one list, longest inside first. A row is "over" when the time inside is more
 * than its limit: a visitor's own `maxDwellMinutes`, or the company's gate time for a vehicle. Computed against `now`, not
 * from the stored flag, so it turns red the minute it applies. Pure.
 */
export function onSiteRows(visits: readonly WithId<Visit>[], passes: readonly WithId<VisitorPass>[], tenant: Pick<Tenant, 'dwellLimitHours'> | null | undefined, now: number, vehicleHref?: (visitId: string) => string | null): OnSiteRow[] {
  const vehicleLimit = dwellLimitHoursOf(tenant ?? null) * 60
  const rows: OnSiteRow[] = []
  for (const v of visits) {
    if (v.status !== 'checked_in') continue
    const at = v.checkIn.timestamp.toMillis()
    rows.push({ key: `v_${v.id}`, kind: 'vehicle', name: v.plateNo, detail: v.driverName, checkedInAt: at, limitMinutes: vehicleLimit, over: Math.floor((now - at) / 60_000) > vehicleLimit, href: vehicleHref?.(v.id) ?? null })
  }
  for (const p of passes) {
    const at = p.checkInAt?.toMillis()
    if (p.status !== 'checked_in' || at === undefined) continue
    const detail = [p.hostName ? `→ ${p.hostName}` : null, p.visitorOrganization].filter(Boolean).join(' · ')
    rows.push({ key: `p_${p.id}`, kind: 'visitor', name: p.visitorName, detail, checkedInAt: at, limitMinutes: p.maxDwellMinutes, over: isOverstay({ status: p.status, checkInAt: at, maxDwellMinutes: p.maxDwellMinutes }, now), href: null })
  }
  return rows.sort((a, b) => a.checkedInAt - b.checkedInAt)
}
