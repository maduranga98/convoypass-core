// Cancels the current approval of a vehicle when something it depended on breaks: a penalty is issued against the
// vehicle or one of its drivers, or a tracked document expires. Called by Firestore triggers (inspectionTriggers.ts), so
// neither Module 2's eligibility job nor Module 3's penalty callables know about inspections. Every cancellation goes
// through the same transaction as recording an inspection (`inspectionTx`), so the record and `vehicles.clearance` never drift.
import { sanitiseMeta } from './auditMeta.js'
import type { DataPort, InspectionPlan } from './core.js'
import { shouldInvalidate, type InvalidationReason } from './inspectionLogic.js'
import { logError, logInfo } from './logger.js'
import type { PenaltyData, VehicleData } from './types.js'

export type InvalidationPort = Pick<DataPort, 'inspectionTx' | 'listVehicleIdsOfDriver' | 'getDriver'>

export interface InvalidationSummary {
  vehicles: number
  invalidated: number
}

interface Request {
  tenantId: string
  vehicleIds: string[]
  reason: InvalidationReason
  /** What caused it (a penalty id, `vehicle`, `driver:<uid>`): kept on the record, never a name. */
  source: string
  /** When the cause happened. Only an approval recorded at or before this instant is cancelled. */
  eventMs: number
  nowMs: number
  /** Re-checked inside the transaction: the cause may have been corrected while the trigger waited. */
  stillApplies?: (vehicle: VehicleData) => boolean
}

/**
 * Cancels the active approval of each vehicle that has one. Idempotent: a vehicle with no active approval (never
 * inspected, already invalidated, rejected) is left alone, so a repeated delivery changes nothing. Every vehicle is tried;
 * if any failed the first error is thrown afterwards so the trigger retries (the ones already done are no-ops then).
 */
async function invalidateVehicles(port: InvalidationPort, r: Request): Promise<InvalidationSummary> {
  const summary: InvalidationSummary = { vehicles: 0, invalidated: 0 }
  let firstError: unknown
  for (const vehicleId of new Set(r.vehicleIds)) {
    summary.vehicles++
    try {
      const outcome = await port.inspectionTx({
        vehicleId,
        plan: ({ vehicle, current }): InspectionPlan | null => {
          // Another tenant's vehicle (a driver's list can name any) and a stale cause are both ignored.
          if (!vehicle || vehicle.tenantId !== r.tenantId || !current) return null
          if (!shouldInvalidate(current, r.eventMs)) return null
          if (r.stillApplies && !r.stillApplies(vehicle)) return null
          return {
            kind: 'invalidate',
            reason: r.reason,
            source: r.source,
            note: null,
            at: r.nowMs,
            audit: {
              tenantId: r.tenantId,
              action: 'inspection.invalidate',
              actorUid: 'system',
              actorRole: 'system',
              targetType: 'inspection',
              targetId: current.id,
              meta: sanitiseMeta({ vehicleId, reason: r.reason, source: r.source }),
            },
          }
        },
      })
      if (outcome.written) summary.invalidated++
    } catch (e) {
      firstError ??= e
      logError({ fn: 'invalidateInspection', tenantId: r.tenantId }, e, { step: 'vehicle' })
    }
  }
  if (firstError) throw firstError
  logInfo({ fn: 'invalidateInspection', tenantId: r.tenantId }, 'ok', { reason: r.reason, ...summary })
  return summary
}

/** A penalty against a vehicle cancels that vehicle's approval; one against a driver cancels every vehicle the driver is assigned to. */
export async function invalidateForPenalty(port: InvalidationPort, penaltyId: string, p: PenaltyData, nowMs: number): Promise<InvalidationSummary> {
  if (p.status !== 'active') return { vehicles: 0, invalidated: 0 }
  const vehicleIds = p.target.vehicleId ? [p.target.vehicleId] : []
  if (p.target.driverId) vehicleIds.push(...(await port.listVehicleIdsOfDriver(p.target.driverId)))
  return invalidateVehicles(port, { tenantId: p.tenantId, vehicleIds, reason: 'penalty_issued', source: penaltyId, eventMs: p.issuedAt, nowMs })
}

/** Insurance or registration expired (`vehicles.eligibilityStatus` became `expired`). */
export function invalidateForVehicleExpiry(port: InvalidationPort, tenantId: string, vehicleId: string, eventMs: number, nowMs: number): Promise<InvalidationSummary> {
  return invalidateVehicles(port, {
    tenantId,
    vehicleIds: [vehicleId],
    reason: 'document_expired',
    source: 'vehicle',
    eventMs,
    nowMs,
    stillApplies: (v) => v.eligibilityStatus === 'expired',
  })
}

/** A driver's licence expired: every vehicle the driver is (still) assigned to needs a new inspection. */
export async function invalidateForDriverExpiry(port: InvalidationPort, tenantId: string, driverId: string, eventMs: number, nowMs: number): Promise<InvalidationSummary> {
  const driver = await port.getDriver(driverId)
  if (!driver || driver.tenantId !== tenantId || driver.eligibilityStatus !== 'expired') return { vehicles: 0, invalidated: 0 }
  return invalidateVehicles(port, {
    tenantId,
    vehicleIds: await port.listVehicleIdsOfDriver(driverId),
    reason: 'document_expired',
    source: `driver:${driverId}`,
    eventMs,
    nowMs,
    stillApplies: (v) => v.assignedDriverIds.includes(driverId),
  })
}

/** The status change the document-expiry hook reacts to: into `expired` from anything else. */
export const becameExpired = (before: string | undefined, after: string | undefined): boolean => after === 'expired' && before !== 'expired'
