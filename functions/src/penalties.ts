// Penalties and suspensions. A penalty takes effect the moment it is issued; supervisor verification is a confirm-after-
// the-fact step and never gates it. Clients only read (rules); every write is one of these callables.
import { resolveDriver } from './checkEligibility.js'
import { audit as makeAudit, parse, PenaltyTypeExistsError, PenaltyTypeInUseError, PenaltyTypeLimitError, requireActiveCaller, type Deps, type PenaltyPlan } from './core.js'
import { dateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { fail } from './errors.js'
import { daysUntil, isoFromDateKey } from './expiry.js'
import { newPenaltyTypeId } from './ids.js'
import { isJpeg, MAX_EVIDENCE_AGE_MS, MAX_EVIDENCE_BYTES } from './passRules.js'
import { can, type Action } from './permissions.js'
import { endOfDayMs, MAX_PENALTY_TYPES, PENALTY_MAX_DAYS, PENALTY_TYPE_NAME_MAX, PENALTY_TYPE_NAME_MIN } from './penaltyLogic.js'
import {
  createPenaltyTypeSchema,
  deletePenaltyTypeSchema,
  issuePenaltySchema,
  revokePenaltySchema,
  updatePenaltyTypeSchema,
  verifyPenaltySchema,
} from './schemas.js'
import type { Caller, PenaltyData, TenantData } from './types.js'

/** The single place a penalty photo may live. Storage rules and `issuePenalty` accept exactly this. */
export const penaltyEvidencePath = (tenantId: string, penaltyId: string): string => `tenants/${tenantId}/penalties/${penaltyId}/evidence.jpg`
const MIN_PENALTY_PHOTO_BYTES = 2 * 1024

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

/** Single spaces, no edges. The key is what uniqueness is checked on (ignores case and spacing). */
const squash = (s: string): string => s.trim().replace(/\s+/g, ' ')

function typeName(raw: string): { name: string; nameKey: string } {
  const name = squash(raw)
  if (name.length < PENALTY_TYPE_NAME_MIN || name.length > PENALTY_TYPE_NAME_MAX) {
    throw fail('invalid-argument', 'invalid-input', 'Invalid penalty type name')
  }
  return { name, nameKey: name.toLowerCase() }
}

// ---- Penalty types (admin) -----------------------------------------------------------------

export async function createPenaltyType(deps: Deps, caller: Caller, raw: unknown): Promise<{ typeId: string }> {
  const input = parse(createPenaltyTypeSchema, raw)
  requireCan(caller, 'penaltyType.manage')
  await requireActiveCaller(deps, caller)
  const { name, nameKey } = typeName(input.name)
  const typeId = newPenaltyTypeId()
  try {
    await deps.data.createPenaltyTypeTx({
      typeId,
      data: { tenantId: caller.tenantId, name, nameKey, createdBy: caller.uid },
      max: MAX_PENALTY_TYPES,
      audit: makeAudit(caller, 'penaltyType.create', typeId, { name }, 'penaltyType'),
    })
  } catch (e) {
    if (e instanceof PenaltyTypeExistsError) throw fail('already-exists', 'penalty-type-exists', 'A penalty type with this name already exists')
    if (e instanceof PenaltyTypeLimitError) throw fail('failed-precondition', 'penalty-type-limit', 'Too many penalty types')
    throw e
  }
  return { typeId }
}

async function loadType(deps: Deps, caller: Caller, typeId: string) {
  const type = await deps.data.getPenaltyType(typeId)
  // Another tenant's type looks exactly like a missing one.
  if (!type || type.tenantId !== caller.tenantId) throw fail('not-found', 'penalty-type-not-found', 'Penalty type not found')
  return type
}

export async function updatePenaltyType(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updatePenaltyTypeSchema, raw)
  requireCan(caller, 'penaltyType.manage')
  await requireActiveCaller(deps, caller)
  const { name, nameKey } = typeName(input.name)
  const before = await loadType(deps, caller, input.typeId)
  if (before.nameKey === nameKey && before.name === name) return { ok: true }
  try {
    await deps.data.renamePenaltyTypeTx({
      typeId: input.typeId,
      tenantId: caller.tenantId,
      name,
      nameKey,
      audit: makeAudit(caller, 'penaltyType.update', input.typeId, { from: before.name, to: name }, 'penaltyType'),
    })
  } catch (e) {
    if (e instanceof PenaltyTypeExistsError) throw fail('already-exists', 'penalty-type-exists', 'A penalty type with this name already exists')
    throw e
  }
  return { ok: true }
}

/** Unused types are removed for real (it is a configuration list); a type any penalty references is kept so history stays readable. */
export async function deletePenaltyType(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(deletePenaltyTypeSchema, raw)
  requireCan(caller, 'penaltyType.manage')
  await requireActiveCaller(deps, caller)
  const type = await loadType(deps, caller, input.typeId)
  try {
    await deps.data.deletePenaltyTypeTx({
      typeId: input.typeId,
      tenantId: caller.tenantId,
      audit: makeAudit(caller, 'penaltyType.delete', input.typeId, { name: type.name }, 'penaltyType'),
    })
  } catch (e) {
    if (e instanceof PenaltyTypeInUseError) throw fail('failed-precondition', 'penalty-type-in-use', 'Penalties still use this type')
    throw e
  }
  return { ok: true }
}

// ---- issuePenalty (admin, Safety Officer) --------------------------------------------------

async function verifyPhoto(deps: Deps, path: string): Promise<void> {
  const stored = await deps.storage.readFile(path, 4)
  if (!stored) throw fail('failed-precondition', 'evidence-missing', 'The photo was not uploaded')
  if (stored.contentType !== 'image/jpeg' || !isJpeg(stored.head)) throw fail('failed-precondition', 'evidence-invalid', 'The photo is not a JPEG')
  if (stored.size < MIN_PENALTY_PHOTO_BYTES || stored.size > MAX_EVIDENCE_BYTES) {
    throw fail('failed-precondition', 'evidence-invalid', 'The photo has an unacceptable size')
  }
  if (deps.now() * 1000 - stored.timeCreated > MAX_EVIDENCE_AGE_MS) throw fail('failed-precondition', 'evidence-stale', 'The photo is too old. Retake it.')
}

export async function issuePenalty(deps: Deps, caller: Caller, raw: unknown): Promise<{ penaltyId: string; created: boolean }> {
  const input = parse(issuePenaltySchema, raw)
  requireCan(caller, 'penalty.issue')
  const actor = await requireActiveCaller(deps, caller)
  const tenantId = caller.tenantId
  const tenant = await deps.data.getTenant(tenantId)
  const tz = timezoneOf(tenant)
  const nowMs = deps.now() * 1000

  const type = await loadType(deps, caller, input.typeId)

  // Targets always come from the server's own records: tenant is checked, names are copied, the contractor is derived.
  const vehicle = input.vehicleId ? await deps.data.getVehicle(input.vehicleId) : null
  if (input.vehicleId && (!vehicle || vehicle.tenantId !== tenantId)) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  const driver = input.driverId ? await resolveDriver(deps, tenantId, input.driverId) : null
  if (input.driverId && !driver) throw fail('not-found', 'user-not-found', 'Driver not found')
  if (vehicle && driver && vehicle.contractorId !== driver.contractorId) {
    throw fail('invalid-argument', 'target-mismatch', 'The driver and the vehicle belong to different contractors')
  }
  const contractorId = (vehicle?.contractorId ?? driver?.contractorId) as string

  let duration: PenaltyData['duration'] = { kind: 'permanent' }
  if (input.duration.kind === 'fixed') {
    const today = isoFromDateKey(dateKey(tz, new Date(nowMs)))
    const left = daysUntil(input.duration.endDate, today)
    if (left < 0 || left > PENALTY_MAX_DAYS) throw fail('invalid-argument', 'end-date-invalid', 'Choose an end date from today onwards')
    duration = { kind: 'fixed', endDate: endOfDayMs(tz, input.duration.endDate) }
  }

  const evidencePath = input.hasEvidence ? penaltyEvidencePath(tenantId, input.penaltyId) : null
  if (evidencePath) await verifyPhoto(deps, evidencePath)

  const penalty: PenaltyData = {
    tenantId,
    contractorId,
    target: { driverId: driver ? input.driverId ?? null : null, vehicleId: vehicle ? input.vehicleId ?? null : null },
    targetLabels: { driverName: driver?.name ?? null, plateNo: vehicle?.plateNo ?? null },
    typeId: input.typeId,
    typeName: type.name,
    duration,
    issuedBy: { uid: caller.uid, name: actor.name, role: caller.role as 'admin' | 'safety' },
    issuedAt: nowMs,
    reason: input.reason,
    evidencePhotoPath: evidencePath,
    status: 'active',
    verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null },
  }
  const res = await deps.data.createPenaltyTx({
    penaltyId: input.penaltyId,
    penalty,
    audit: makeAudit(
      caller,
      'penalty.issue',
      input.penaltyId,
      {
        typeId: input.typeId,
        vehicleId: penalty.target.vehicleId,
        driverId: penalty.target.driverId,
        permanent: duration.kind === 'permanent',
        endDate: duration.kind === 'fixed' ? duration.endDate : null,
        hasEvidence: evidencePath !== null,
      },
      'penalty',
    ),
  })
  // A retry of the same call (same id, same issuer) succeeds with the stored penalty; any other clash is refused.
  if (!res.created && (res.penalty.tenantId !== tenantId || res.penalty.issuedBy.uid !== caller.uid)) {
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }
  return { penaltyId: input.penaltyId, created: res.created }
}

// ---- revokePenalty (admin only) ------------------------------------------------------------

export async function revokePenalty(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(revokePenaltySchema, raw)
  requireCan(caller, 'penalty.revoke')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  await deps.data.updatePenaltyTx({
    penaltyId: input.penaltyId,
    plan: (p): PenaltyPlan => {
      if (!p || p.tenantId !== caller.tenantId) throw fail('not-found', 'penalty-not-found', 'Penalty not found')
      // Revoking lifts a penalty that is in force: an ended or already revoked one has nothing left to lift.
      if (p.status !== 'active') throw fail('failed-precondition', 'penalty-not-active', 'This penalty is no longer active')
      return {
        patch: { status: 'revoked', revocation: { byUid: caller.uid, byName: actor.name, at: nowMs, note: input.note } },
        audit: makeAudit(caller, 'penalty.revoke', input.penaltyId, { typeId: p.typeId }, 'penalty'),
      }
    },
  })
  return { ok: true }
}

// ---- verifyPenalty (supervisor, own contractor) --------------------------------------------

/** A confirm-reviewed step after the fact: it changes nothing about whether the penalty blocks. */
export async function verifyPenalty(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(verifyPenaltySchema, raw)
  requireCan(caller, 'penalty.verify')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const note = input.note && input.note.length > 0 ? input.note : null
  await deps.data.updatePenaltyTx({
    penaltyId: input.penaltyId,
    plan: (p): PenaltyPlan => {
      // Another contractor's penalty looks exactly like a missing one.
      if (!p || p.tenantId !== caller.tenantId || p.contractorId !== caller.contractorId) {
        throw fail('not-found', 'penalty-not-found', 'Penalty not found')
      }
      if (p.status === 'revoked') throw fail('failed-precondition', 'penalty-revoked', 'This penalty was revoked')
      if (p.verification.verifiedBy !== null) throw fail('failed-precondition', 'already-verified', 'This penalty was already reviewed')
      return {
        patch: { verification: { verifiedBy: caller.uid, verifiedByName: actor.name, verifiedAt: nowMs, verificationNote: note } },
        audit: makeAudit(caller, 'penalty.verify', input.penaltyId, { hasNote: note !== null }, 'penalty'),
      }
    },
  })
  return { ok: true }
}
