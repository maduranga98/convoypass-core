import {
  audit,
  eligibilityContext,
  parse,
  PlateTakenError,
  requireActiveCaller,
  requireActiveContractor,
  VehicleIdTakenError,
  type Deps,
} from './core.js'
import { fail, failWith } from './errors.js'
import { can } from './permissions.js'
import { normalisePlate } from './plate.js'
import {
  createVehicleSchema,
  importVehiclesSchema,
  setContractorStatusSchema,
  setVehicleDriversSchema,
  setVehicleStatusSchema,
  updateVehicleSchema,
} from './schemas.js'
import type { AuditEntry, Caller, VehicleData, VehiclePatch } from './types.js'
import { computeEligibility } from './expiry.js'
import { annualInspectionOk, annualInspectionState } from './requirementLogic.js'
import { effectiveVehicleTypes } from './vehicleTypes.js'
import { blockingPenalties } from './penaltyLogic.js'

const MAX_ID_ATTEMPTS = 3

/** Only admins and supervisors manage vehicles. Callers are already verified against their `users` doc. */
async function requireVehicleManager(deps: Deps, caller: Caller): Promise<void> {
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin' && caller.role !== 'supervisor') {
    throw fail('permission-denied', 'forbidden', 'You are not allowed to manage vehicles')
  }
}

/** Admin names the contractor; a supervisor is always forced to their own, whatever the client sent. */
function scopedContractorId(caller: Caller, requested: string | undefined): string {
  const id = caller.role === 'supervisor' ? caller.contractorId : (requested ?? null)
  if (!id) throw fail('invalid-argument', 'invalid-input', 'contractorId is required')
  return id
}

async function loadManagedVehicle(deps: Deps, caller: Caller, vehicleId: string): Promise<VehicleData> {
  const vehicle = await deps.data.getVehicle(vehicleId)
  if (!vehicle) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  if (vehicle.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Vehicle belongs to a different tenant')
  }
  if (caller.role === 'supervisor' && vehicle.contractorId !== caller.contractorId) {
    throw fail('permission-denied', 'forbidden', 'You are not allowed to manage this vehicle')
  }
  return vehicle
}

/** Every driver must be an active driver of this contractor and tenant. */
async function assertDriversAssignable(
  deps: Deps,
  tenantId: string,
  contractorId: string,
  driverIds: string[],
): Promise<string[]> {
  const unique = [...new Set(driverIds)]
  const found = await deps.data.getDrivers(unique)
  for (const uid of unique) {
    const d = found.get(uid)
    if (!d || d.tenantId !== tenantId || d.contractorId !== contractorId || d.status !== 'active') {
      throw fail('failed-precondition', 'driver-invalid', 'Drivers must be active and belong to the same contractor')
    }
  }
  return unique
}

/** A driver drives one vehicle: anyone in `driverIds` who is not already on `current` must not be assigned to another vehicle. */
async function assertDriversFree(deps: Deps, tenantId: string, driverIds: string[], currentVehicleId?: string, current: readonly string[] = []): Promise<void> {
  const added = driverIds.filter((id) => !current.includes(id))
  if (added.length === 0) return
  const taken = await deps.data.findDriverAssignments({ tenantId, driverIds: added, exceptVehicleId: currentVehicleId })
  const first = added.map((id) => taken.get(id)).find((t) => t !== undefined)
  if (first) throw failWith('failed-precondition', 'driver-assigned', 'This driver is already assigned to another vehicle', { plateNo: first.plateNo })
}

function assertKnownType(allowed: readonly string[], type: string): void {
  if (!allowed.includes(type)) throw fail('invalid-argument', 'invalid-type', 'Unknown vehicle type')
}

type VehicleDates = { insuranceExpiry?: string | null; registrationExpiry?: string | null; annualInspectionExpiry?: string | null }
const eligibilityOf = (v: VehicleDates, today: string, warningDays: number) =>
  computeEligibility([v.insuranceExpiry, v.registrationExpiry, v.annualInspectionExpiry], today, warningDays)

/** A vehicle can only be given drivers while its annual inspection is valid (a missing one counts as not valid). */
function assertAnnualInspectionValid(v: VehicleDates, today: string, warningDays: number): void {
  if (!annualInspectionOk(annualInspectionState(v.annualInspectionExpiry, today, warningDays))) {
    throw fail('failed-precondition', 'annual-inspection-invalid', 'The vehicle needs a valid annual inspection before drivers can be assigned')
  }
}

const plateTaken = () => fail('already-exists', 'plate-exists', 'A vehicle with this plate already exists')

/** Creates the vehicle in one transaction; retries with a fresh id on the (vanishingly rare) id collision. */
async function createVehicleOnce(
  deps: Deps,
  caller: Caller,
  vehicle: Omit<VehicleData, 'status' | 'assignedDriverIds'> & { assignedDriverIds: string[] },
  via: 'manual' | 'import',
): Promise<string> {
  const data: VehicleData = { ...vehicle, status: 'active' }
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const vehicleId = deps.newVehicleId()
    try {
      await deps.data.createVehicleTx({
        vehicleId,
        vehicle: data,
        actorUid: caller.uid,
        audit: audit(
          caller,
          'vehicle.create',
          vehicleId,
          { plateKey: data.plateKey, contractorId: data.contractorId, via },
          'vehicle',
        ),
      })
      return vehicleId
    } catch (e) {
      if (e instanceof VehicleIdTakenError) continue
      throw e
    }
  }
  throw fail('internal', 'internal', 'Could not allocate a vehicle id')
}

// ---- createVehicle -------------------------------------------------------------------------

export async function createVehicle(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ vehicleId: string; plateNo: string }> {
  const input = parse(createVehicleSchema, raw)
  await requireVehicleManager(deps, caller)

  const contractorId = scopedContractorId(caller, input.contractorId)
  await requireActiveContractor(deps, caller, contractorId)

  const plate = normalisePlate(input.plateNo)
  if (!plate) throw fail('invalid-argument', 'invalid-input', 'Invalid plate number')
  const assignedDriverIds = await assertDriversAssignable(deps, caller.tenantId, contractorId, input.driverIds ?? [])
  await assertDriversFree(deps, caller.tenantId, assignedDriverIds)
  const ctx = await eligibilityContext(deps, caller.tenantId)
  assertKnownType(effectiveVehicleTypes(ctx.tenant?.vehicleTypes), input.type)
  if (assignedDriverIds.length > 0) assertAnnualInspectionValid(input, ctx.today, ctx.warningDays)

  try {
    const vehicleId = await createVehicleOnce(
      deps,
      caller,
      {
        tenantId: caller.tenantId,
        contractorId,
        plateNo: plate.plateNo,
        plateKey: plate.plateKey,
        type: input.type,
        ...(input.makeModel ? { makeModel: input.makeModel } : {}),
        assignedDriverIds,
        ...(input.insuranceExpiry ? { insuranceExpiry: input.insuranceExpiry } : {}),
        ...(input.registrationExpiry ? { registrationExpiry: input.registrationExpiry } : {}),
        ...(input.annualInspectionExpiry ? { annualInspectionExpiry: input.annualInspectionExpiry } : {}),
        eligibilityStatus: eligibilityOf(input, ctx.today, ctx.warningDays),
      },
      'manual',
    )
    return { vehicleId, plateNo: plate.plateNo }
  } catch (e) {
    if (e instanceof PlateTakenError) throw plateTaken()
    throw e
  }
}

// ---- updateVehicle -------------------------------------------------------------------------

export async function updateVehicle(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateVehicleSchema, raw)
  await requireVehicleManager(deps, caller)
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)

  const patch: VehiclePatch = {}
  const meta: AuditEntry['meta'] = {}
  let plate: { plateNo: string; plateKey: string } | undefined

  if (input.plateNo !== undefined) {
    const next = normalisePlate(input.plateNo)
    if (!next) throw fail('invalid-argument', 'invalid-input', 'Invalid plate number')
    if (next.plateNo !== vehicle.plateNo) {
      patch.plateNo = next.plateNo
      meta.plate = true
      if (next.plateKey !== vehicle.plateKey) plate = next
    }
  }
  let ctx: Awaited<ReturnType<typeof eligibilityContext>> | undefined
  const context = async () => (ctx ??= await eligibilityContext(deps, vehicle.tenantId))
  if (input.type !== undefined && input.type !== vehicle.type) {
    assertKnownType(effectiveVehicleTypes((await context()).tenant?.vehicleTypes), input.type)
    patch.type = input.type
    meta.type = true
  }
  const dates = { insuranceExpiry: vehicle.insuranceExpiry ?? null, registrationExpiry: vehicle.registrationExpiry ?? null, annualInspectionExpiry: vehicle.annualInspectionExpiry ?? null }
  for (const key of ['insuranceExpiry', 'registrationExpiry', 'annualInspectionExpiry'] as const) {
    if (input[key] !== undefined && input[key] !== dates[key]) {
      patch[key] = input[key]
      dates[key] = input[key]
      meta[key] = true
    }
  }
  if (meta.insuranceExpiry || meta.registrationExpiry || meta.annualInspectionExpiry) {
    const c = await context()
    patch.eligibilityStatus = eligibilityOf(dates, c.today, c.warningDays)
  }
  if (input.makeModel !== undefined && input.makeModel !== (vehicle.makeModel ?? '')) {
    patch.makeModel = input.makeModel === '' ? null : input.makeModel
    meta.makeModel = true
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  try {
    await deps.data.updateVehicleTx({
      vehicleId: input.vehicleId,
      patch,
      ...(plate ? { plate } : {}),
      audit: audit(caller, 'vehicle.update', input.vehicleId, meta, 'vehicle'),
    })
  } catch (e) {
    if (e instanceof PlateTakenError) throw plateTaken()
    throw e
  }
  return { ok: true }
}

// ---- setVehicleStatus ----------------------------------------------------------------------

export async function setVehicleStatus(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(setVehicleStatusSchema, raw)
  await requireVehicleManager(deps, caller)
  if (!can(caller.role, 'vehicle.setStatus')) throw fail('permission-denied', 'forbidden', 'Only an admin can suspend or activate a vehicle')
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)
  if (vehicle.status === input.status) return { ok: true }

  await deps.data.updateVehicleTx({
    vehicleId: input.vehicleId,
    patch: { status: input.status },
    audit: audit(
      caller,
      input.status === 'suspended' ? 'vehicle.suspend' : 'vehicle.activate',
      input.vehicleId,
      {},
      'vehicle',
    ),
  })
  return { ok: true }
}

// ---- setVehicleDrivers ---------------------------------------------------------------------

export async function setVehicleDrivers(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(setVehicleDriversSchema, raw)
  await requireVehicleManager(deps, caller)
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)
  const assignedDriverIds = await assertDriversAssignable(deps, vehicle.tenantId, vehicle.contractorId, input.driverIds)

  // A driver under an active penalty cannot be newly assigned (the screen disables them too). Keeping or removing one is fine.
  const added = assignedDriverIds.filter((id) => !vehicle.assignedDriverIds.includes(id))
  await assertDriversFree(deps, vehicle.tenantId, assignedDriverIds, input.vehicleId, vehicle.assignedDriverIds)
  if (added.length > 0) {
    const ctx = await eligibilityContext(deps, vehicle.tenantId)
    assertAnnualInspectionValid(vehicle, ctx.today, ctx.warningDays)
    const nowMs = deps.now() * 1000
    const perDriver = await Promise.all(added.map((driverId) => deps.data.listActivePenalties({ tenantId: vehicle.tenantId, driverId })))
    if (perDriver.some((active, i) => blockingPenalties(active, { driverId: added[i] as string }, nowMs).length > 0)) {
      throw fail('failed-precondition', 'penalty-blocked', 'A driver under an active penalty cannot be assigned')
    }
  }

  await deps.data.updateVehicleTx({
    vehicleId: input.vehicleId,
    patch: { assignedDriverIds },
    audit: audit(caller, 'vehicle.setDrivers', input.vehicleId, { count: assignedDriverIds.length }, 'vehicle'),
  })
  return { ok: true }
}

// ---- importVehicles ------------------------------------------------------------------------

export type ImportRowError = 'invalid-plate' | 'invalid-type' | 'invalid-make-model' | 'plate-exists' | 'internal'

export interface ImportRowResult {
  /** 1-based position in the submitted `rows`. */
  row: number
  ok: boolean
  vehicleId?: string
  error?: ImportRowError
}

/** Each row is its own transaction: one bad row never fails the batch. */
export async function importVehicles(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ results: ImportRowResult[]; created: number }> {
  const input = parse(importVehiclesSchema, raw)
  await requireVehicleManager(deps, caller)
  const contractorId = scopedContractorId(caller, input.contractorId)
  await requireActiveContractor(deps, caller, contractorId)

  const allowedTypes = effectiveVehicleTypes((await deps.data.getTenant(caller.tenantId))?.vehicleTypes)
  const results: ImportRowResult[] = []
  for (const [i, row] of input.rows.entries()) {
    const result = (error: ImportRowError): ImportRowResult => ({ row: i + 1, ok: false, error })
    const plate = normalisePlate(row.plateNo)
    if (!plate) {
      results.push(result('invalid-plate'))
      continue
    }
    const type = row.type.trim()
    if (!allowedTypes.includes(type)) {
      results.push(result('invalid-type'))
      continue
    }
    const makeModel = (row.makeModel ?? '').trim()
    if (makeModel.length > 60) {
      results.push(result('invalid-make-model'))
      continue
    }
    try {
      const vehicleId = await createVehicleOnce(
        deps,
        caller,
        {
          tenantId: caller.tenantId,
          contractorId,
          plateNo: plate.plateNo,
          plateKey: plate.plateKey,
          type,
          ...(makeModel ? { makeModel } : {}),
          assignedDriverIds: [],
        },
        'import',
      )
      results.push({ row: i + 1, ok: true, vehicleId })
    } catch (e) {
      results.push(result(e instanceof PlateTakenError ? 'plate-exists' : 'internal'))
    }
  }

  const created = results.filter((r) => r.ok).length
  await deps.data
    .writeAudit(
      audit(caller, 'vehicle.import', contractorId, { rows: input.rows.length, created, failed: results.length - created }, 'contractor'),
    )
    .catch(() => undefined) // the per-vehicle entries are already written; the summary is best-effort
  return { results, created }
}

// ---- setContractorStatus -------------------------------------------------------------------

export async function setContractorStatus(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true; revoked: number }> {
  const input = parse(setContractorStatusSchema, raw)
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin') throw fail('permission-denied', 'forbidden', 'Only admins can change a contractor status')

  const contractor = await deps.data.getContractor(input.contractorId)
  if (!contractor) throw fail('not-found', 'contractor-not-found', 'Contractor not found')
  if (contractor.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Contractor belongs to a different tenant')
  }

  const changed = contractor.status !== input.status
  // Activating changes the doc only: users who were disabled individually stay disabled.
  if (!changed && input.status === 'active') return { ok: true, revoked: 0 }

  if (changed) {
    try {
      await deps.data.setContractorStatusWithAudit(
        input.contractorId,
        input.status,
        audit(
          caller,
          input.status === 'suspended' ? 'contractor.suspend' : 'contractor.activate',
          input.contractorId,
          {},
          'contractor',
        ),
      )
    } catch {
      throw fail('internal', 'internal', 'Could not update contractor')
    }
  }
  if (input.status === 'active') return { ok: true, revoked: 0 }

  // Suspending (also when it was already suspended, so a partly failed revoke can be retried).
  const uids = await deps.data.listUserIdsByContractor(caller.tenantId, input.contractorId)
  const outcomes = await Promise.allSettled(uids.map((uid) => deps.auth.revokeRefreshTokens(uid)))
  const failures = outcomes.filter((o) => o.status === 'rejected').length
  if (failures > 0) throw fail('internal', 'internal', 'Contractor suspended, but some sessions could not be revoked. Retry.')
  return { ok: true, revoked: uids.length }
}
