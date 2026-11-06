import { audit, parse, PassConflictError, requireActiveCaller, type Deps } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { DEFAULT_CHECKLIST, DEFAULT_PASS_SETTINGS } from './defaultChecklist.js'
import { OTHER_REASON_ID } from './defaultRejectionReasons.js'
import { fail } from './errors.js'
import {
  evidenceFolder,
  expectedAttempt,
  isJpeg,
  MAX_EVIDENCE_AGE_MS,
  MAX_EVIDENCE_BYTES,
  MIN_EVIDENCE_BYTES,
  validateChecklist,
} from './passRules.js'
import { effectiveVehicleTypes } from './vehicleTypes.js'
import {
  MAX_ATTEMPTS,
  resolveVehicleSchema,
  submitPassSchema,
  updateTenantSettingsSchema,
  VEHICLE_ID_PATTERN,
} from './schemas.js'
import type {
  Caller,
  ChecklistItemDef,
  EvidenceFile,
  PassChecklistItem,
  PassData,
  PassSettings,
  PassWrite,
  VehicleData,
} from './types.js'

// ---- Result types (mirrored in src/types/passes.ts) -----------------------------------------

export interface VehicleSummary {
  id: string
  plateNo: string
  type: string
}
export interface PassSummary {
  passId: string
  plateNo: string
  status: PassData['status']
  submittedAt: number | null
  driverName: string
  /** True when the caller submitted it, so the client may read the document itself (rules allow only that). */
  mine: boolean
}
interface FormContext {
  vehicle: VehicleSummary
  attempt: number
  checklist: ChecklistItemDef[]
  passSettings: PassSettings
  dateKey: string
}

export type ResolveResult =
  | ({ state: 'can_submit' } & FormContext)
  | ({
      state: 'can_resubmit'
      rejection: { reason: string; at: number }
      previous: { attempt: number; checklist: PassChecklistItem[] }
    } & FormContext)
  | { state: 'pending' | 'approved' | 'checked_in'; pass: PassSummary }
  /** A rejected pass this driver cannot resubmit: another driver owns it, or all attempts are used. */
  | { state: 'rejected_locked'; reason: 'other_driver' | 'max_attempts'; pass: PassSummary }
  | { state: 'not_assigned' | 'vehicle_suspended' | 'contractor_suspended' | 'not_found' }

// ---- Eligibility -------------------------------------------------------------------------------

interface Context {
  vehicleId: string
  vehicle: VehicleData
  driverName: string
  timezone: string
  passSettings: PassSettings
  checklist: ChecklistItemDef[]
  dateKey: string
  passId: string
  existing: PassData | null
}

type Eligibility = { block: Extract<ResolveResult, { state: 'not_assigned' | 'vehicle_suspended' | 'contractor_suspended' | 'not_found' }> } | { ctx: Context }

/** The id of a pass. Single place so the "per vehicle per day" scheme can change later. */
export const passIdFor = (vehicleId: string, dateKey: string): string => `${vehicleId}_${dateKey}`

/**
 * Shared by resolveVehicle and submitPass. Drivers only; tenant, driver status and assignment come from the
 * server-side records, never from the request. Nothing about a vehicle is revealed before assignment is proven.
 */
async function loadContext(deps: Deps, caller: Caller, vehicleId: string): Promise<Eligibility> {
  if (caller.role !== 'driver') throw fail('permission-denied', 'forbidden', 'Only drivers can use this')
  // A suspended contractor is a result state here, not an error, so skip that part of the generic check.
  const user = await requireActiveCaller(deps, caller, { checkContractor: false })

  if (!VEHICLE_ID_PATTERN.test(vehicleId)) return { block: { state: 'not_found' } }
  const vehicle = await deps.data.getVehicle(vehicleId)
  if (!vehicle || vehicle.tenantId !== caller.tenantId) return { block: { state: 'not_found' } }
  if (!vehicle.assignedDriverIds.includes(caller.uid) || vehicle.contractorId !== caller.contractorId) {
    return { block: { state: 'not_assigned' } }
  }
  if (vehicle.status !== 'active') return { block: { state: 'vehicle_suspended' } }
  const contractor = await deps.data.getContractor(vehicle.contractorId)
  if (!contractor || contractor.tenantId !== caller.tenantId || contractor.status !== 'active') {
    return { block: { state: 'contractor_suspended' } }
  }

  const tenant = await deps.data.getTenant(caller.tenantId)
  const timezone = tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE
  const dateKey = computeDateKey(timezone, new Date(deps.now() * 1000))
  const passId = passIdFor(vehicleId, dateKey)
  const existing = await deps.data.getPass(passId)
  return {
    ctx: {
      vehicleId,
      vehicle,
      driverName: user.name,
      timezone,
      passSettings: { ...DEFAULT_PASS_SETTINGS, ...tenant?.passSettings },
      checklist: tenant?.checklist && tenant.checklist.length > 0 ? tenant.checklist : [...DEFAULT_CHECKLIST],
      dateKey,
      passId,
      existing,
    },
  }
}

type Standing =
  | { kind: 'new' }
  | { kind: 'resubmit'; existing: PassData }
  | { kind: 'taken'; existing: PassData }
  | { kind: 'locked'; existing: PassData; reason: 'other_driver' | 'max_attempts' }

function standing(ctx: Context, uid: string): Standing {
  const { existing } = ctx
  if (!existing) return { kind: 'new' }
  if (existing.status !== 'rejected') return { kind: 'taken', existing }
  if (existing.driverId !== uid) return { kind: 'locked', existing, reason: 'other_driver' }
  if (existing.attempt >= MAX_ATTEMPTS) return { kind: 'locked', existing, reason: 'max_attempts' }
  return { kind: 'resubmit', existing }
}

const summary = (p: PassData, uid: string): PassSummary => ({
  passId: passIdFor(p.vehicleId, p.dateKey),
  plateNo: p.plateNo,
  status: p.status,
  submittedAt: p.submittedAt,
  driverName: p.driverName,
  mine: p.driverId === uid,
})

const formContext = (ctx: Context, attempt: number): FormContext => ({
  vehicle: { id: ctx.vehicleId, plateNo: ctx.vehicle.plateNo, type: ctx.vehicle.type },
  attempt,
  checklist: ctx.checklist,
  passSettings: ctx.passSettings,
  dateKey: ctx.dateKey,
})

// ---- resolveVehicle ----------------------------------------------------------------------------

export async function resolveVehicle(deps: Deps, caller: Caller, raw: unknown): Promise<ResolveResult> {
  const input = parse(resolveVehicleSchema, raw)
  const found = await loadContext(deps, caller, input.vehicleId)
  if ('block' in found) return found.block
  const { ctx } = found

  const s = standing(ctx, caller.uid)
  switch (s.kind) {
    case 'new':
      return { state: 'can_submit', ...formContext(ctx, 1) }
    case 'resubmit': {
      const rejection = s.existing.rejection
      return {
        state: 'can_resubmit',
        ...formContext(ctx, expectedAttempt(s.existing)),
        rejection: { reason: rejection?.reason ?? '', at: rejection?.at ?? 0 },
        previous: { attempt: s.existing.attempt, checklist: s.existing.checklist },
      }
    }
    case 'locked':
      return { state: 'rejected_locked', reason: s.reason, pass: summary(s.existing, caller.uid) }
    case 'taken': {
      const st = s.existing.status
      const state = st === 'checked_in' ? 'checked_in' : st === 'officer_approved' ? 'approved' : 'pending'
      return { state, pass: summary(s.existing, caller.uid) }
    }
  }
}

// ---- submitPass --------------------------------------------------------------------------------

async function verifyEvidence(
  deps: Deps,
  base: string,
  files: readonly string[],
): Promise<EvidenceFile[]> {
  const nowMs = deps.now() * 1000
  return Promise.all(
    files.map(async (file) => {
      const path = `${base}${file}`
      const stored = await deps.storage.readFile(path, 4)
      if (!stored) throw fail('failed-precondition', 'evidence-missing', `Photo ${file} was not uploaded`)
      if (stored.contentType !== 'image/jpeg' || !isJpeg(stored.head)) {
        throw fail('failed-precondition', 'evidence-invalid', `Photo ${file} is not a JPEG`)
      }
      if (stored.size < MIN_EVIDENCE_BYTES || stored.size > MAX_EVIDENCE_BYTES) {
        throw fail('failed-precondition', 'evidence-invalid', `Photo ${file} has an unacceptable size`)
      }
      if (nowMs - stored.timeCreated > MAX_EVIDENCE_AGE_MS) {
        throw fail('failed-precondition', 'evidence-stale', `Photo ${file} is too old. Retake it.`)
      }
      return { path, size: stored.size, contentType: stored.contentType }
    }),
  )
}

export async function submitPass(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ passId: string; status: 'submitted'; attempt: number }> {
  const input = parse(submitPassSchema, raw)
  const found = await loadContext(deps, caller, input.vehicleId)
  if ('block' in found) {
    switch (found.block.state) {
      case 'not_assigned':
        throw fail('permission-denied', 'not-assigned', 'This vehicle is not assigned to you')
      case 'vehicle_suspended':
        throw fail('failed-precondition', 'vehicle-suspended', 'This vehicle cannot be used right now')
      case 'contractor_suspended':
        throw fail('failed-precondition', 'contractor-suspended', 'This vehicle cannot be used right now')
      default:
        throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
    }
  }
  const { ctx } = found

  const s = standing(ctx, caller.uid)
  if (s.kind === 'taken') throw fail('already-exists', 'pass-exists', 'A pass for this vehicle already exists today')
  if (s.kind === 'locked') {
    throw s.reason === 'other_driver'
      ? fail('permission-denied', 'not-resubmitter', 'Only the driver who submitted this pass can resubmit it')
      : fail('failed-precondition', 'attempts-exhausted', 'All attempts are used. Contact your supervisor.')
  }
  const expected = expectedAttempt(ctx.existing)
  if (input.attempt !== expected) throw fail('failed-precondition', 'attempt-mismatch', 'Attempt number is out of date')

  const checklist = validateChecklist(ctx.checklist, input.checklist)
  if (input.extraCount > ctx.passSettings.maxExtraPhotos) {
    throw fail('invalid-argument', 'invalid-input', 'Too many extra photos')
  }
  const { location, ...restMeta } = input.captureMeta
  if (ctx.passSettings.requireLocation && !location) {
    throw fail('failed-precondition', 'location-required', 'Location is required to submit')
  }

  const base = evidenceFolder(caller.tenantId, ctx.vehicleId, ctx.dateKey, input.attempt)
  const extras = Array.from({ length: input.extraCount }, (_, i) => `extra${i + 1}.jpg`)
  const [gps, dashcam, ...extra] = await verifyEvidence(deps, base, ['gps.jpg', 'dashcam.jpg', ...extras])
  if (!gps || !dashcam) throw fail('internal', 'internal', 'Evidence check failed')

  const pass: PassWrite = {
    tenantId: caller.tenantId,
    contractorId: ctx.vehicle.contractorId,
    vehicleId: ctx.vehicleId,
    plateNo: ctx.vehicle.plateNo,
    vehicleType: ctx.vehicle.type,
    dateKey: ctx.dateKey,
    driverId: caller.uid,
    driverName: ctx.driverName,
    attempt: input.attempt,
    checklist,
    evidence: { gps, dashcam, extra },
    captureMeta: { ...restMeta, ...(location ? { location } : {}) },
  }

  try {
    await deps.data.submitPassTx({
      passId: ctx.passId,
      pass,
      audit: audit(
        caller,
        input.attempt === 1 ? 'pass.submit' : 'pass.resubmit',
        ctx.passId,
        {
          vehicleId: ctx.vehicleId,
          attempt: input.attempt,
          extraCount: input.extraCount,
          method: input.captureMeta.method,
          answersNo: checklist.filter((c) => c.answer === 'no').length,
        },
        'pass',
      ),
    })
  } catch (e) {
    if (e instanceof PassConflictError) {
      if (e.kind === 'exists') throw fail('already-exists', 'pass-exists', 'A pass for this vehicle already exists today')
      if (e.kind === 'driver') {
        throw fail('permission-denied', 'not-resubmitter', 'Only the driver who submitted this pass can resubmit it')
      }
      throw fail('failed-precondition', 'attempt-mismatch', 'Attempt number is out of date')
    }
    throw e
  }
  return { passId: ctx.passId, status: 'submitted', attempt: input.attempt }
}

// ---- updateTenantSettings ----------------------------------------------------------------------

export async function updateTenantSettings(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateTenantSettingsSchema, raw)
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin') throw fail('permission-denied', 'forbidden', 'Only admins can change settings')

  if (input.checklist && new Set(input.checklist.map((c) => c.id)).size !== input.checklist.length) {
    throw fail('invalid-argument', 'invalid-input', 'Checklist ids must be unique')
  }
  if (input.rejectionReasons) {
    // Ids are created once and never edited (passes keep the code they were rejected with); `other` is always there.
    if (new Set(input.rejectionReasons.map((r) => r.id)).size !== input.rejectionReasons.length) {
      throw fail('invalid-argument', 'invalid-input', 'Reason ids must be unique')
    }
    if (!input.rejectionReasons.some((r) => r.id === OTHER_REASON_ID)) {
      throw fail('invalid-argument', 'invalid-input', 'The “other” reason cannot be removed')
    }
  }
  if (input.qualificationTypes) {
    // Ids are slugs created once; drivers keep their records under the id, so removing a type only stops requiring it.
    const ids = input.qualificationTypes.map((t) => t.id)
    const names = input.qualificationTypes.map((t) => t.name.toLowerCase())
    if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
      throw fail('invalid-argument', 'invalid-input', 'Qualification ids and names must be unique')
    }
  }
  if (input.gates) {
    // Ids are slugs created once and never edited (check-ins and denials keep the id); at least one gate remains.
    if (new Set(input.gates.map((g) => g.id)).size !== input.gates.length) {
      throw fail('invalid-argument', 'invalid-input', 'Gate ids must be unique')
    }
  }
  const tenant = await deps.data.getTenant(caller.tenantId)
  if (!tenant) throw fail('failed-precondition', 'internal', 'Tenant not found')
  if (input.vehicleTypes) {
    const next = new Set(input.vehicleTypes.map((t) => t.toLowerCase()))
    if (next.size !== input.vehicleTypes.length) throw fail('invalid-argument', 'invalid-input', 'Vehicle types must be unique')
    // Vehicles keep the type name, so a name that any vehicle still uses can be neither removed nor renamed.
    for (const type of effectiveVehicleTypes(tenant.vehicleTypes)) {
      if (!input.vehicleTypes.includes(type) && (await deps.data.countVehiclesOfType(caller.tenantId, type)) > 0) {
        throw fail('failed-precondition', 'type-in-use', 'A vehicle type that vehicles use cannot be removed')
      }
    }
  }

  await deps.data.updateTenantSettingsWithAudit(
    caller.tenantId,
    {
      ...(input.passSettings ? { passSettings: input.passSettings } : {}),
      ...(input.checklist ? { checklist: input.checklist } : {}),
      ...(input.rejectionReasons ? { rejectionReasons: input.rejectionReasons } : {}),
      ...(input.gates ? { gates: input.gates } : {}),
      ...(input.sla ? { sla: input.sla } : {}),
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
      ...(input.vehicleTypes ? { vehicleTypes: input.vehicleTypes } : {}),
      ...(input.expiryWarningDays !== undefined ? { expiryWarningDays: input.expiryWarningDays } : {}),
      ...(input.dwellLimitHours !== undefined ? { dwellLimitHours: input.dwellLimitHours } : {}),
      ...(input.autoIssueGatePasses !== undefined ? { autoIssueGatePasses: input.autoIssueGatePasses } : {}),
      ...(input.qualificationTypes ? { qualificationTypes: input.qualificationTypes } : {}),
    },
    audit(
      caller,
      'tenant.settings.update',
      caller.tenantId,
      {
        passSettings: input.passSettings !== undefined,
        checklistItems: input.checklist?.length ?? null,
        rejectionReasons: input.rejectionReasons?.length ?? null,
        gates: input.gates?.length ?? null,
        sla: input.sla !== undefined,
        retentionDays: input.retentionDays ?? null,
        vehicleTypes: input.vehicleTypes?.length ?? null,
        expiryWarningDays: input.expiryWarningDays ?? null,
        dwellLimitHours: input.dwellLimitHours ?? null,
        autoIssueGatePasses: input.autoIssueGatePasses ?? null,
        qualificationTypes: input.qualificationTypes?.length ?? null,
        requireLocation: input.passSettings?.requireLocation ?? null,
        maxExtraPhotos: input.passSettings?.maxExtraPhotos ?? null,
      },
      'tenant',
    ),
  )
  return { ok: true }
}
