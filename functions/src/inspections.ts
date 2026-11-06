// Inspections and trip clearance. A Safety Officer records an inspection; an approved one clears the vehicle for every
// trip until a penalty or an expired document cancels it (inspectionInvalidation.ts) and a NEW inspection restores it.
// Records are never edited: a new inspection supersedes the current one. Clients only read (rules); every write is here.
import { audit as makeAudit, parse, requireActiveCaller, type Deps, type InspectionPlan } from './core.js'
import { fail } from './errors.js'
import { clearanceOf, REJECTION_NOTE_MIN, shouldInvalidate, type ClearanceStatus } from './inspectionLogic.js'
import { can, type Action } from './permissions.js'
import { recordInspectionSchema, withdrawClearanceSchema } from './schemas.js'
import type { Caller, InspectionData, VehicleData } from './types.js'

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

/** Another tenant's vehicle looks exactly like a missing one. */
function ownVehicle(vehicle: VehicleData | null, tenantId: string): VehicleData {
  if (!vehicle || vehicle.tenantId !== tenantId) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  return vehicle
}

// ---- recordInspection (Safety Officer) -----------------------------------------------------

export async function recordInspection(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ inspectionId: string; created: boolean; clearance: ClearanceStatus }> {
  const input = parse(recordInspectionSchema, raw)
  requireCan(caller, 'inspection.record')
  const actor = await requireActiveCaller(deps, caller)
  // A rejection has to say what was wrong, so the contractor knows what to fix before the re-inspection.
  if (input.result === 'rejected' && input.notes.length < REJECTION_NOTE_MIN) {
    throw fail('invalid-argument', 'notes-required', 'Say what was wrong')
  }
  const nowMs = deps.now() * 1000

  const outcome = await deps.data.inspectionTx({
    vehicleId: input.vehicleId,
    plan: ({ vehicle, current }): InspectionPlan => {
      const v = ownVehicle(vehicle, caller.tenantId)
      const inspection: InspectionData = {
        tenantId: caller.tenantId,
        vehicleId: input.vehicleId,
        contractorId: v.contractorId,
        plateNo: v.plateNo,
        inspectedBy: { uid: caller.uid, name: actor.name },
        inspectedAt: nowMs,
        result: input.result,
        notes: input.notes,
        status: 'active',
        invalidatedReason: null,
        invalidatedAt: null,
      }
      return {
        kind: 'record',
        inspectionId: input.inspectionId,
        inspection,
        audit: makeAudit(
          caller,
          'inspection.record',
          input.inspectionId,
          { vehicleId: input.vehicleId, result: input.result, supersedes: current?.id ?? null, hasNotes: input.notes.length > 0 },
          'inspection',
        ),
      }
    },
  })

  // A retry of a call that already went through: same id, same officer, same vehicle. Anything else is a clash.
  if (!outcome.written) {
    const stored = outcome.current
    if (!stored || stored.id !== input.inspectionId || stored.tenantId !== caller.tenantId || stored.inspectedBy.uid !== caller.uid || stored.vehicleId !== input.vehicleId) {
      throw fail('already-exists', 'request-conflict', 'This request was already used')
    }
  }
  return { inspectionId: input.inspectionId, created: outcome.written, clearance: clearanceOf(outcome.current).status }
}

// ---- withdrawClearance (Safety Officer) ----------------------------------------------------

/** Cancels the current approval without a new inspection (`invalidatedReason: 'manual'`), for example a defect seen on the road. */
export async function withdrawClearance(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(withdrawClearanceSchema, raw)
  requireCan(caller, 'inspection.withdraw')
  await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  await deps.data.inspectionTx({
    vehicleId: input.vehicleId,
    plan: ({ vehicle, current }): InspectionPlan => {
      ownVehicle(vehicle, caller.tenantId)
      // Only a standing approval can be withdrawn; asking twice, or on a vehicle that was never cleared, is refused.
      if (!current || !shouldInvalidate(current, nowMs)) throw fail('failed-precondition', 'not-cleared', 'This vehicle is not cleared')
      return {
        kind: 'invalidate',
        reason: 'manual',
        source: caller.uid,
        note: input.note,
        at: nowMs,
        audit: makeAudit(caller, 'inspection.withdraw', current.id, { vehicleId: input.vehicleId }, 'inspection'),
      }
    },
  })
  return { ok: true }
}
