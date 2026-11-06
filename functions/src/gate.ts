// Module 5: the gate. Security reads passes, vehicles, drivers and contractors directly from Firestore; the only
// writes are these two callables. The server decides what "today" is and re-checks everything that blocks entry.
import { evaluateEligibility } from './checkEligibility.js'
import { audit as makeAudit, parse, requireActiveCaller, type CheckInPlan, type DecisionContext, type Deps } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { DENY_OTHER_ID, DENY_REASONS, MIN_DENY_NOTE } from './denyReasons.js'
import { fail, failWith } from './errors.js'
import { gatesOf } from './gates.js'
import { visitIdForRequest } from './ids.js'
import { passIdFor } from './passes.js'
import { findTransition } from './passTransitions.js'
import { checkInSchema, denyEntrySchema } from './schemas.js'
import type { Caller, CheckInStamp, GateDef, GateEventData, PassStatus, TenantData, VisitData } from './types.js'

/** An offline capture time may be at most this far ahead of the server clock (device clock drift). */
export const OFFLINE_MAX_FUTURE_MS = 2 * 60_000
/** ...and at most this old when it finally syncs. */
export const OFFLINE_MAX_AGE_MS = 12 * 60 * 60_000

export interface CheckInResult {
  passId: string
  status: 'checked_in'
  /** Server time of the check-in, milliseconds (the stored one when a request is replayed). */
  at: number
}

export interface DenyEntryResult {
  eventId: string
  /** Server time, milliseconds. */
  at: number
  passStatus: PassStatus | null
}

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

function requireGate(tenant: TenantData | null, gateId: string): GateDef {
  const gate = gatesOf(tenant).find((g) => g.id === gateId)
  if (!gate) throw fail('invalid-argument', 'gate-invalid', 'Choose a valid gate')
  return gate
}

function requireSecurity(caller: Caller): void {
  if (caller.role !== 'security') throw fail('permission-denied', 'forbidden', 'Only security can do this at the gate')
}

/**
 * The day a check-in belongs to: today on the server clock, or for an offline capture the day it was captured on
 * (so a check-in made at 23:55 still syncs after midnight). The capture time is bounded, never trusted further.
 */
function checkInDay(tz: string, nowMs: number, offlineCapturedAt: string | undefined): { day: string; offline: boolean } {
  if (offlineCapturedAt === undefined) return { day: computeDateKey(tz, new Date(nowMs)), offline: false }
  const captured = Date.parse(offlineCapturedAt)
  if (captured > nowMs + OFFLINE_MAX_FUTURE_MS) {
    throw fail('invalid-argument', 'offline-time-future', 'The device clock is ahead. Check the phone’s date and time.')
  }
  if (captured < nowMs - OFFLINE_MAX_AGE_MS) {
    throw fail('failed-precondition', 'offline-time-stale', 'This offline check-in is more than 12 hours old')
  }
  return { day: computeDateKey(tz, new Date(captured)), offline: true }
}

interface CheckInInput {
  caller: Caller
  actorName: string
  passId: string
  expectedAttempt: number
  gate: GateDef
  requestId: string
  offlineCapturedAt: string | undefined
  day: string
  offline: boolean
  nowMs: number
  /** An active penalty blocks the vehicle or the driver (the shared eligibility check, evaluated just before the transaction). */
  penaltyBlocked?: boolean
}

/** Pure: decides a check-in from what the transaction read. Throws HttpsError to refuse. */
export function planCheckIn(i: CheckInInput, ctx: DecisionContext | null): CheckInPlan {
  if (!ctx) throw fail('not-found', 'pass-not-found', 'Pass not found')
  const { pass } = ctx
  if (pass.tenantId !== i.caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'That pass belongs to a different organisation')
  }
  if (pass.status === 'checked_in') {
    // Idempotency: the same request always gets the same answer; a different one learns who was first.
    if (pass.checkIn?.requestId === i.requestId) return { kind: 'replay', checkIn: pass.checkIn }
    throw failWith('already-exists', 'pass-checked-in', 'This vehicle is already checked in', {
      byName: pass.checkIn?.name ?? null,
      at: pass.checkIn?.at ?? null,
      gateName: pass.checkIn?.gateName ?? null,
    })
  }
  const move = findTransition(pass.status, 'check_in', 'gate')
  if (!move) throw failWith('failed-precondition', 'pass-not-approved', 'This pass is not approved', { status: pass.status })
  if (!move.roles.includes(i.caller.role)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  if (pass.attempt !== i.expectedAttempt) throw fail('failed-precondition', 'pass-changed', 'This pass changed. Review it again.')
  if (pass.dateKey !== i.day) {
    throw i.offline
      ? fail('failed-precondition', 'offline-day-mismatch', 'This offline check-in was captured on a different day than the pass')
      : fail('failed-precondition', 'pass-expired', 'This pass is from a previous day')
  }
  const tenantId = i.caller.tenantId
  if (!ctx.vehicle || ctx.vehicle.tenantId !== tenantId || ctx.vehicle.status !== 'active') {
    throw fail('failed-precondition', 'vehicle-suspended', 'This vehicle is suspended')
  }
  if (!ctx.driver || ctx.driver.tenantId !== tenantId || ctx.driver.status !== 'active') {
    throw fail('failed-precondition', 'driver-inactive', 'This driver is disabled')
  }
  if (!ctx.contractor || ctx.contractor.tenantId !== tenantId || ctx.contractor.status !== 'active') {
    throw fail('failed-precondition', 'contractor-suspended', 'This contractor is suspended')
  }
  // Penalties (suspensions) override a valid, approved pass.
  if (i.penaltyBlocked) throw fail('failed-precondition', 'penalty-blocked', 'This vehicle or driver is suspended by a penalty')

  const checkIn: CheckInStamp = {
    uid: i.caller.uid,
    name: i.actorName,
    at: i.nowMs,
    gateId: i.gate.id,
    gateName: i.gate.name,
    requestId: i.requestId,
    ...(i.offlineCapturedAt !== undefined ? { offlineCapturedAt: i.offlineCapturedAt } : {}),
  }
  // The first entry of the day also opens the day's first gate visit (in and out can then repeat; see visits.ts).
  const visit: VisitData = {
    tenantId,
    vehicleId: pass.vehicleId,
    passId: i.passId,
    driverId: pass.driverId,
    contractorId: pass.contractorId,
    plateNo: pass.plateNo,
    driverName: pass.driverName,
    checkIn: {
      timestamp: i.nowMs,
      dateKey: i.day,
      securityUserId: i.caller.uid,
      securityUserName: i.actorName,
      gateId: i.gate.id,
      gateLocation: i.gate.name,
      requestId: i.requestId,
    },
    unloadingCheck: null,
    checkOut: null,
    status: 'checked_in',
    driverOnDutyLock: true,
    dwellWarning: false,
  }
  return {
    kind: 'write',
    checkIn,
    visit: { id: visitIdForRequest(i.requestId), data: visit },
    entry: {
      action: 'check_in', stage: 'gate', byUid: i.caller.uid, byName: i.actorName, byRole: i.caller.role,
      at: i.nowMs, attempt: pass.attempt,
    },
    audit: makeAudit(
      i.caller,
      'pass.checkIn',
      i.passId,
      { passId: i.passId, attempt: pass.attempt, gateId: i.gate.id, requestId: i.requestId, offline: i.offline },
      'pass',
    ),
  }
}

// ---- checkIn -----------------------------------------------------------------------------------

export async function checkIn(deps: Deps, caller: Caller, raw: unknown): Promise<CheckInResult> {
  const input = parse(checkInSchema, raw)
  requireSecurity(caller)
  const actor = await requireActiveCaller(deps, caller)
  const tenant = await deps.data.getTenant(caller.tenantId)
  const gate = requireGate(tenant, input.gateId)
  const nowMs = deps.now() * 1000
  const { day, offline } = checkInDay(timezoneOf(tenant), nowMs, input.offlineCapturedAt)

  // The live penalty check (shared `evaluateEligibility`): only for a pass that could be let in, so a replayed or
  // already checked-in request is answered exactly as before.
  const pass = await deps.data.getPass(input.passId)
  const penaltyBlocked =
    pass !== null && pass.tenantId === caller.tenantId && pass.status === 'officer_approved'
      ? (await evaluateEligibility(deps, caller.tenantId, { vehicleId: pass.vehicleId, driverId: pass.driverId })).blocked
      : false

  const done = await deps.data.checkInTx({
    passId: input.passId,
    plan: (ctx) =>
      planCheckIn(
        {
          caller, actorName: actor.name, passId: input.passId, expectedAttempt: input.expectedAttempt, gate,
          requestId: input.requestId, offlineCapturedAt: input.offlineCapturedAt, day, offline, nowMs, penaltyBlocked,
        },
        ctx,
      ),
  })
  return { passId: input.passId, status: 'checked_in', at: done.checkIn.at }
}

// ---- denyEntry ---------------------------------------------------------------------------------

export async function denyEntry(deps: Deps, caller: Caller, raw: unknown): Promise<DenyEntryResult> {
  const input = parse(denyEntrySchema, raw)
  requireSecurity(caller)
  const actor = await requireActiveCaller(deps, caller)
  const tenant = await deps.data.getTenant(caller.tenantId)
  const gate = requireGate(tenant, input.gateId)

  if (!DENY_REASONS.some((r) => r.id === input.reasonCode)) throw fail('invalid-argument', 'reason-invalid', 'Choose a valid reason')
  const note = input.note && input.note.length > 0 ? input.note : undefined
  if (input.reasonCode === DENY_OTHER_ID && (note?.length ?? 0) < MIN_DENY_NOTE) {
    throw fail('invalid-argument', 'note-required', 'Add a short note for this reason')
  }

  // Unknown and foreign vehicles look the same: nothing about another tenant is revealed.
  const vehicle = await deps.data.getVehicle(input.vehicleId)
  if (!vehicle || vehicle.tenantId !== caller.tenantId) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')

  const nowMs = deps.now() * 1000
  const day = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  const passId = passIdFor(input.vehicleId, day)
  const found = await deps.data.getPass(passId)
  const pass = found && found.tenantId === caller.tenantId ? found : null

  const eventId = `den_${input.requestId}`
  const event: GateEventData = {
    tenantId: caller.tenantId,
    type: 'denied',
    vehicleId: input.vehicleId,
    plateNo: vehicle.plateNo,
    contractorId: vehicle.contractorId,
    passId: pass ? passId : null,
    passStatus: pass ? pass.status : null,
    driverName: pass ? pass.driverName : null,
    dateKey: day,
    reasonCode: input.reasonCode,
    ...(note ? { note } : {}),
    gateId: gate.id,
    gateName: gate.name,
    byUid: caller.uid,
    byName: actor.name,
    at: nowMs,
    requestId: input.requestId,
  }
  const res = await deps.data.denyEntryTx({
    eventId,
    event,
    audit: makeAudit(
      caller,
      'gate.deny',
      eventId,
      { vehicleId: input.vehicleId, passId: event.passId, passStatus: event.passStatus, reasonCode: input.reasonCode, gateId: gate.id },
      'gateEvent',
    ),
  })
  // A replay must come from the same guard of the same tenant; anything else is a clashing id.
  if (!res.created && (res.event.tenantId !== caller.tenantId || res.event.byUid !== caller.uid)) {
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }
  return { eventId, at: res.event.at, passStatus: res.event.passStatus }
}
