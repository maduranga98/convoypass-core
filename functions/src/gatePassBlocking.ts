// Blocks active gate passes when a condition behind them fails. Called by the SAME Firestore triggers that cancel a vehicle's
// inspection (inspectionTriggers.ts), so there is no fourth parallel listener: one event, two reactions. Each function
// re-checks that the cause still holds (a delayed or retried delivery must not block a pass whose problem was already
// corrected and which the admin reactivated), then calls the one blocking routine in gatePasses.ts.
import type { DataPort } from './core.js'
import { blockActivePasses, currentMonthOf, type GatePassPort } from './gatePasses.js'
import { blockReasonForClearance } from './gatePassLogic.js'
import { isBlocking } from './penaltyLogic.js'
import type { PenaltyData } from './types.js'

export type BlockingData = Pick<DataPort, 'getTenant' | 'getPenalty' | 'getVehicle' | 'getDriver'>

export interface BlockingDeps {
  port: GatePassPort
  data: BlockingData
}

const none = { matched: 0, blocked: 0 }

/** A new penalty against a vehicle blocks that vehicle's passes; against a driver, every pass of that driver. */
export async function blockForPenalty(d: BlockingDeps, penaltyId: string, p: PenaltyData, nowMs: number) {
  if (p.status !== 'active') return none
  // The penalty may have been revoked while the trigger waited.
  const live = await d.data.getPenalty(penaltyId)
  if (!live || !isBlocking(live, nowMs)) return none
  const currentMonth = currentMonthOf(await d.data.getTenant(p.tenantId), nowMs)
  const base = { tenantId: p.tenantId, reason: 'penalty' as const, source: penaltyId, nowMs, currentMonth }
  const a = p.target.vehicleId ? await blockActivePasses(d.port, { ...base, scope: { vehicleId: p.target.vehicleId } }) : none
  const b = p.target.driverId ? await blockActivePasses(d.port, { ...base, scope: { driverId: p.target.driverId } }) : none
  return { matched: a.matched + b.matched, blocked: a.blocked + b.blocked }
}

/** Insurance or registration expired (`vehicles.eligibilityStatus` became `expired`). */
export async function blockForVehicleExpiry(d: BlockingDeps, tenantId: string, vehicleId: string, nowMs: number) {
  const vehicle = await d.data.getVehicle(vehicleId)
  if (!vehicle || vehicle.tenantId !== tenantId || vehicle.eligibilityStatus !== 'expired') return none
  const currentMonth = currentMonthOf(await d.data.getTenant(tenantId), nowMs)
  return blockActivePasses(d.port, { tenantId, scope: { vehicleId }, reason: 'document_expired', source: 'vehicle', nowMs, currentMonth })
}

/** A driver's licence expired: every pass of that driver. */
export async function blockForDriverExpiry(d: BlockingDeps, tenantId: string, driverId: string, nowMs: number) {
  const driver = await d.data.getDriver(driverId)
  if (!driver || driver.tenantId !== tenantId || driver.eligibilityStatus !== 'expired') return none
  const currentMonth = currentMonthOf(await d.data.getTenant(tenantId), nowMs)
  return blockActivePasses(d.port, { tenantId, scope: { driverId }, reason: 'document_expired', source: `driver:${driverId}`, nowMs, currentMonth })
}

/**
 * The vehicle's clearance changed to "needs re-inspection" or "rejected" (`vehicles.clearance`, written in the same
 * transaction as the inspection record). The reason keeps the original cause: a penalty or an expired document that cancelled the
 * inspection is reported as such, a withdrawn or rejected inspection as `inspection_invalidated`. First cause wins, so
 * whichever trigger runs first, the pass shows the same reason.
 */
export async function blockForClearance(d: BlockingDeps, tenantId: string, vehicleId: string, nowMs: number) {
  const vehicle = await d.data.getVehicle(vehicleId)
  if (!vehicle || vehicle.tenantId !== tenantId || !vehicle.clearance || vehicle.clearance.status === 'cleared') return none
  const currentMonth = currentMonthOf(await d.data.getTenant(tenantId), nowMs)
  return blockActivePasses(d.port, {
    tenantId,
    scope: { vehicleId },
    reason: blockReasonForClearance(vehicle.clearance.reason),
    source: 'clearance',
    nowMs,
    currentMonth,
  })
}
