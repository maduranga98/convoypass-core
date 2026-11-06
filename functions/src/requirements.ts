// Driver qualifications (safety induction, defensive driving, work instruction, ...) and the driver's own permit numbers.
// Both live on `drivers/{uid}` and are written ONLY by these callables (clients read the driver document, rules unchanged).
// A required qualification that is missing or expired makes the driver not eligible (checkEligibility consumes
// `requirementLogic`); permits are information only and never block anything.
import { audit, eligibilityContext, parse, requireActiveCaller, type Deps } from './core.js'
import { fail } from './errors.js'
import { can } from './permissions.js'
import {
  effectiveQualificationTypes,
  MAX_PERMITS,
  normalisePermitNumber,
  permitExpiry,
  PERMIT_NUMBER_MAX,
  PERMIT_NUMBER_MIN,
  qualificationExpiry,
  type PermitRecord,
  type QualificationRecords,
} from './requirementLogic.js'
import { recordQualificationSchema, setMyPermitsSchema } from './schemas.js'
import { daysUntil } from './expiry.js'
import type { Caller, DriverData } from './types.js'

/** The driver document, created from the `users` record for a driver that predates Module 2. Another tenant's driver looks missing. */
async function loadDriver(deps: Deps, tenantId: string, uid: string): Promise<{ doc: DriverData | null; backfill: DriverData }> {
  const doc = await deps.data.getDriver(uid)
  if (doc && doc.tenantId === tenantId) return { doc, backfill: doc }
  const user = await deps.data.getUser(uid)
  if (!user || user.tenantId !== tenantId || user.role !== 'driver' || !user.contractorId) throw fail('not-found', 'user-not-found', 'Driver not found')
  return { doc: null, backfill: { tenantId, contractorId: user.contractorId, name: user.name, phone: user.phone, status: user.status } }
}

/**
 * `recordQualification({ driverId, typeId, completedOn })`: Admin or Officer records that a driver completed a training.
 * The server adds one year; recording again replaces the earlier record (a renewal). The date cannot be in the future.
 */
export async function recordQualification(deps: Deps, caller: Caller, raw: unknown): Promise<{ expiresOn: string }> {
  const input = parse(recordQualificationSchema, raw)
  if (!can(caller.role, 'qualification.record')) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  const actor = await requireActiveCaller(deps, caller)
  const ctx = await eligibilityContext(deps, caller.tenantId)
  if (!effectiveQualificationTypes(ctx.tenant?.qualificationTypes).some((t) => t.id === input.typeId)) {
    throw fail('invalid-argument', 'qualification-unknown', 'Unknown qualification')
  }
  if (daysUntil(input.completedOn, ctx.today) > 0) throw fail('invalid-argument', 'date-future', 'The date cannot be in the future')

  const { doc, backfill } = await loadDriver(deps, caller.tenantId, input.driverId)
  const expiresOn = qualificationExpiry(input.completedOn)
  const qualifications: QualificationRecords = {
    ...(doc?.qualifications ?? {}),
    [input.typeId]: { completedOn: input.completedOn, expiresOn, recordedByUid: caller.uid, recordedByName: actor.name, recordedAt: deps.now() * 1000 },
  }
  await deps.data.updateUserWithAudit(
    input.driverId,
    {},
    audit(caller, 'qualification.record', input.driverId, { typeId: input.typeId, completedOn: input.completedOn, expiresOn }, 'qualification'),
    { patch: { qualifications }, ...(doc ? {} : { backfill }) },
  )
  return { expiresOn }
}

/**
 * `setMyPermits({ permits })`: the signed-in driver replaces their own list (0-2 numbers). A number that was already on
 * the list keeps its date; a new one is dated today and valid for three months. Information only: nothing is blocked.
 */
export async function setMyPermits(deps: Deps, caller: Caller, raw: unknown): Promise<{ permits: PermitRecord[] }> {
  const input = parse(setMyPermitsSchema, raw)
  if (!can(caller.role, 'permit.set')) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  await requireActiveCaller(deps, caller)
  const numbers = input.permits.map(normalisePermitNumber)
  if (numbers.some((n) => n.length < PERMIT_NUMBER_MIN || n.length > PERMIT_NUMBER_MAX)) throw fail('invalid-argument', 'permit-invalid', 'Check the permit number')
  if (new Set(numbers).size !== numbers.length || numbers.length > MAX_PERMITS) throw fail('invalid-argument', 'permit-invalid', 'Check the permit number')

  const ctx = await eligibilityContext(deps, caller.tenantId)
  const { doc, backfill } = await loadDriver(deps, caller.tenantId, caller.uid)
  const permits: PermitRecord[] = numbers.map((number) => {
    const kept = doc?.permits?.find((p) => p.number === number)
    return kept ?? { number, enteredOn: ctx.today, expiresOn: permitExpiry(ctx.today) }
  })
  await deps.data.updateUserWithAudit(caller.uid, {}, audit(caller, 'permits.update', caller.uid, { count: permits.length }, 'user'), {
    patch: { permits },
    ...(doc ? {} : { backfill }),
  })
  return { permits }
}
