import { dateKey, DEFAULT_TIMEZONE } from './dates.js'
import { computeEligibility, isoFromDateKey, warningDaysOf, type EligibilityStatus } from './expiry.js'
import { logError, logInfo } from './logger.js'
import type { DriverData, TenantData, VehicleData } from './types.js'

/** Documents read per page and written per transaction. */
export const ELIGIBILITY_PAGE_SIZE = 400

export type DatedField = 'insuranceExpiry' | 'registrationExpiry' | 'annualInspectionExpiry' | 'licenseExpiry'

/** A status to write, with the dates it was computed from: the port refuses it when a callable changed them meanwhile. */
export interface StatusUpdate {
  id: string
  status: EligibilityStatus
  dates: Partial<Record<DatedField, string | null>>
}

export interface EligibilityPort {
  listTenants(): Promise<{ id: string; data: TenantData }[]>
  /** One page ordered by document id, after `after` (exclusive). */
  listVehicles(tenantId: string, after: string | null, limit: number): Promise<{ id: string; data: VehicleData }[]>
  listDrivers(tenantId: string, after: string | null, limit: number): Promise<{ id: string; data: DriverData }[]>
  /** Writes `eligibilityStatus` only (no `updatedAt`: it is derived). Returns how many were written. */
  applyVehicleStatuses(updates: StatusUpdate[]): Promise<number>
  applyDriverStatuses(updates: StatusUpdate[]): Promise<number>
}

export interface EligibilitySummary {
  tenants: number
  vehicles: number
  drivers: number
  changed: number
  failedTenants: number
}

const vehicleUpdate = (id: string, v: VehicleData, today: string, warningDays: number): StatusUpdate | null => {
  const status = computeEligibility([v.insuranceExpiry, v.registrationExpiry, v.annualInspectionExpiry], today, warningDays)
  if (v.eligibilityStatus === status) return null
  return { id, status, dates: { insuranceExpiry: v.insuranceExpiry ?? null, registrationExpiry: v.registrationExpiry ?? null, annualInspectionExpiry: v.annualInspectionExpiry ?? null } }
}

const driverUpdate = (id: string, d: DriverData, today: string, warningDays: number): StatusUpdate | null => {
  const status = computeEligibility([d.licenseExpiry], today, warningDays)
  if (d.eligibilityStatus === status) return null
  return { id, status, dates: { licenseExpiry: d.licenseExpiry ?? null } }
}

/**
 * Daily job: recomputes `eligibilityStatus` on every vehicle and driver from the stored dates, today (in each
 * tenant's timezone) and the tenant's warning window. Only records whose status changed are written. Idempotent, and
 * one failing tenant never stops the others. Records without any expiry date are `valid` (not tracked).
 */
export async function recomputeEligibility(port: EligibilityPort, nowMs: number): Promise<EligibilitySummary> {
  const summary: EligibilitySummary = { tenants: 0, vehicles: 0, drivers: 0, changed: 0, failedTenants: 0 }
  for (const tenant of await port.listTenants()) {
    summary.tenants++
    const today = isoFromDateKey(dateKey(tenant.data.timezone ?? DEFAULT_TIMEZONE, new Date(nowMs)))
    const warningDays = warningDaysOf(tenant.data.expiryWarningDays)
    try {
      for (const kind of ['vehicles', 'drivers'] as const) {
        let after: string | null = null
        for (;;) {
          const page: { id: string; data: VehicleData | DriverData }[] =
            kind === 'vehicles'
              ? await port.listVehicles(tenant.id, after, ELIGIBILITY_PAGE_SIZE)
              : await port.listDrivers(tenant.id, after, ELIGIBILITY_PAGE_SIZE)
          const updates = page
            .map((r) =>
              kind === 'vehicles'
                ? vehicleUpdate(r.id, r.data as VehicleData, today, warningDays)
                : driverUpdate(r.id, r.data as DriverData, today, warningDays),
            )
            .filter((u): u is StatusUpdate => u !== null)
          if (updates.length > 0) {
            summary.changed += await (kind === 'vehicles' ? port.applyVehicleStatuses(updates) : port.applyDriverStatuses(updates))
          }
          summary[kind] += page.length
          const last = page[page.length - 1]
          if (!last || page.length < ELIGIBILITY_PAGE_SIZE) break
          after = last.id
        }
      }
    } catch (e) {
      summary.failedTenants++
      logError({ fn: 'recomputeEligibility', tenantId: tenant.id }, e, { step: 'tenant' })
    }
  }
  logInfo({ fn: 'recomputeEligibility' }, 'ok', { ...summary })
  return summary
}
