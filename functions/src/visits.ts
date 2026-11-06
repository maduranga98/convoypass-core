// Visit lifecycle: one record per vehicle visit with three stages. Security checks a vehicle in (after the combined
// `evaluateEligibility` of the penalty/inspection/document modules, which is CONSUMED here, never re-derived) and out; the
// Yard Officer logs the unloading check. Clients only read `visits` (rules); every write is one of these callables.
//
// The driver is identified by their PIN, typed at the gate: the server resolves it through `pinIndex` (HMAC under the
// PIN_PEPPER), throttles failures per guard and answers every failure with the same generic error, so the gate cannot be
// used to find out which PINs exist. The PIN is never stored, logged, audited or returned.
import { eligibleWithoutInspection, evaluateEligibility, type EligibilityResult } from './checkEligibility.js'
import { audit as makeAudit, parse, requireActiveCaller, type Deps } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { fail, failWith } from './errors.js'
import { isoFromDateKey } from './expiry.js'
import { gatesOf } from './gates.js'
import { logError } from './logger.js'
import { checkGatePassForCheckIn, type GatePassPort } from './gatePasses.js'
import type { GatePassCheck } from './gatePassLogic.js'
import { passIdFor } from './passes.js'
import { endOfDayMs } from './penaltyLogic.js'
import { can, type Action } from './permissions.js'
import { checkInVisitSchema, checkOutVisitSchema, logUnloadingCheckSchema } from './schemas.js'
import type { AuditEntry, Caller, DriverData, PassData, TenantData, UserData, VehicleData, VisitData } from './types.js'
import { dwellLimitHoursOf, summaryMetricsFor, withinGateTime, type SummaryMetric } from './visitLogic.js'

// ---- Port (Firestore in production, fakes in tests) ----------------------------------------------

export type VisitRecord = VisitData & { id: string }

/** What the check-in transaction read. */
export interface CheckInContext {
  /** `visits/{visitId}` when it already exists (a retry). */
  existing: VisitRecord | null
  /** A visit of this vehicle that is still checked in (at most one is ever expected). */
  vehicleActive: VisitRecord | null
  driver: DriverData | null
  /** The driver's `users` doc (fallback profile for drivers that predate Module 2). */
  driverUser: UserData | null
}

export type CheckInPlan = { kind: 'replay'; visit: VisitRecord } | { kind: 'write'; visit: VisitData; audit: AuditEntry }

export type CheckOutPlan = { kind: 'replay'; visit: VisitRecord } | { kind: 'write'; checkOut: NonNullable<VisitData['checkOut']>; audit: AuditEntry }

export type UnloadPlan = { unloadingCheck: NonNullable<VisitData['unloadingCheck']>; audit: AuditEntry }

export type SummaryStage = 'checkIn' | 'unloadingCheck' | 'checkOut'

export interface VisitScope {
  tenantId: string
  /** A supervisor sees their own contractor's visits only. */
  contractorId: string | null
}

export interface VisitPort {
  /** The monthly gate pass of a pairing (Module 6): see `GatePassPort.lookupForPairing`. Read only. */
  lookupForPairing: GatePassPort['lookupForPairing']
  getVisit(visitId: string): Promise<VisitRecord | null>
  /**
   * ONE transaction: reads the visit id, the vehicle's active visit and the driver (`drivers` + `users`), hands them to
   * `plan` (pure; throws HttpsError to refuse) and writes the visit, `driverOnDutyLock` + `activeVisitId` on the driver
   * and the audit entry together. Two concurrent check-ins of one driver cannot both write.
   */
  checkInTx(p: { visitId: string; tenantId: string; vehicleId: string; driverId: string; plan: (ctx: CheckInContext) => CheckInPlan }): Promise<CheckInPlan>
  /** ONE transaction: re-reads the visit, plans the check-out, flips `status`, clears the driver's lock and audits. `null` visit = missing. */
  checkOutTx(p: { visitId: string; plan: (visit: VisitRecord | null) => CheckOutPlan }): Promise<CheckOutPlan>
  /** ONE transaction: re-reads the visit and writes `unloadingCheck` + audit. */
  unloadTx(p: { visitId: string; plan: (visit: VisitRecord | null) => UnloadPlan }): Promise<UnloadPlan>
  /** Visits whose `stage` happened on `dateKey` (`count()`, no documents read). */
  countStage(scope: VisitScope, stage: SummaryStage, dateKey: string): Promise<number>
  /** Visits still checked in; `awaitingUnload` keeps those without an unloading check. */
  countActive(scope: VisitScope, opts: { awaitingUnload: boolean }): Promise<number>
  /** Visits still checked in that carry the dwell warning, longest first. */
  listDwell(scope: VisitScope, limit: number): Promise<VisitRecord[]>
  /** Penalties issued between the two instants (inclusive), `count()`. */
  countPenaltiesIssued(scope: VisitScope, fromMs: number, toMs: number): Promise<number>
}

// ---- Shared helpers -----------------------------------------------------------------------

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

/** Another tenant's visit looks exactly like a missing one. */
function ownVisit(visit: VisitRecord | null, tenantId: string): VisitRecord {
  if (!visit || visit.tenantId !== tenantId) throw fail('not-found', 'visit-not-found', 'Visit not found')
  return visit
}

// ---- checkInVisit ----------------------------------------------------------------------------

export type CheckInVisitResult =
  | { outcome: 'checked_in'; visitId: string; at: number; driverName: string; plateNo: string }
  /** Entry refused by the shared eligibility check: `eligibility` is its output, unchanged (documents, penalties, clearance). */
  | { outcome: 'blocked'; driverName: string; plateNo: string; eligibility: EligibilityResult }
  /** Eligible, but the pairing has no active monthly gate pass: none this month, blocked (with the reason) or expired. */
  | { outcome: 'no_gate_pass'; driverName: string; plateNo: string; gatePass: Exclude<GatePassCheck, { state: 'active' }> }

interface PlanInput {
  caller: Caller
  actorName: string
  visitId: string
  requestId: string
  vehicle: VehicleData & { id: string }
  passId: string
  driverId: string
  gate: { id: string; name: string } | null
  dateKey: string
  nowMs: number
}

/** Pure: decides a check-in from what the transaction read. Throws HttpsError to refuse. */
export function planVisitCheckIn(i: PlanInput, ctx: CheckInContext): CheckInPlan {
  const { caller, vehicle } = i
  if (ctx.existing) {
    // A retry of a call that already went through: same id, same guard, same vehicle. Anything else is a clash.
    const e = ctx.existing
    if (e.tenantId === caller.tenantId && e.checkIn.securityUserId === caller.uid && e.vehicleId === i.vehicle.id && e.driverId === i.driverId) {
      return { kind: 'replay', visit: e }
    }
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }
  const driver = ctx.driver && ctx.driver.tenantId === caller.tenantId ? ctx.driver : null
  const profileName = driver?.name ?? ctx.driverUser?.name
  const contractorId = driver?.contractorId ?? ctx.driverUser?.contractorId
  if (!profileName || !contractorId) throw fail('failed-precondition', 'driver-inactive', 'This driver is disabled')
  if (ctx.vehicleActive) {
    throw failWith('failed-precondition', 'vehicle-on-site', 'This vehicle is already checked in', {
      byName: ctx.vehicleActive.checkIn.securityUserName,
      at: ctx.vehicleActive.checkIn.timestamp,
    })
  }
  // The duty lock is enforced here, inside the transaction: the UI cannot be the only guard.
  if (driver?.driverOnDutyLock === true) {
    throw failWith('failed-precondition', 'driver-on-duty', 'This driver is already on a visit', {
      visitId: driver?.activeVisitId ?? null,
    })
  }
  const visit: VisitData = {
    tenantId: caller.tenantId,
    vehicleId: vehicle.id,
    passId: i.passId,
    driverId: i.driverId,
    contractorId: vehicle.contractorId,
    plateNo: vehicle.plateNo,
    driverName: profileName,
    checkIn: {
      timestamp: i.nowMs,
      dateKey: i.dateKey,
      securityUserId: caller.uid,
      securityUserName: i.actorName,
      gateId: i.gate?.id ?? null,
      gateLocation: i.gate?.name ?? null,
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
    visit,
    audit: makeAudit(caller, 'visit.checkIn', i.visitId, { vehicleId: vehicle.id, driverId: i.driverId, gateId: i.gate?.id ?? null }, 'visit'),
  }
}

/**
 * The pass a vehicle is currently "inside" the gate window of: today's or yesterday's pass (the window can run past
 * midnight) that was checked in, newest first. Null when the vehicle has no such pass.
 */
async function openWindowPass(deps: Deps, tenantId: string, vehicleId: string, tz: string, nowMs: number): Promise<{ id: string; pass: PassData } | null> {
  const days = [computeDateKey(tz, new Date(nowMs)), computeDateKey(tz, new Date(nowMs - 24 * 3_600_000))]
  for (const day of [...new Set(days)]) {
    const id = passIdFor(vehicleId, day)
    const pass = await deps.data.getPass(id)
    if (pass && pass.tenantId === tenantId && pass.status === 'checked_in' && pass.checkIn) return { id, pass }
  }
  return null
}

/**
 * A later entry of a vehicle that already checked in today (the first entry is the pass check-in). No PIN: the guard picks
 * the vehicle by QR or by plate and the driver is the one on the day's pass. Allowed only inside the gate time (default
 * 16 hours from the pass's first check-in), while the vehicle is outside, and while it is eligible (no new safety inspection per trip).
 */
export async function checkInVisit(deps: Deps, port: VisitPort, caller: Caller, raw: unknown): Promise<CheckInVisitResult> {
  const input = parse(checkInVisitSchema, raw)
  requireCan(caller, 'visit.checkIn')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)

  // Unknown and foreign vehicles look the same.
  const vehicle = await deps.data.getVehicle(input.vehicleId)
  if (!vehicle || vehicle.tenantId !== caller.tenantId) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  const withId = { ...vehicle, id: input.vehicleId }

  let gate: { id: string; name: string } | null = null
  if (input.gateId !== undefined) {
    gate = gatesOf(tenant).find((g) => g.id === input.gateId) ?? null
    if (!gate) throw fail('invalid-argument', 'gate-invalid', 'Choose a valid gate')
  }

  // A retry of a check-in that already went through answers from the stored visit.
  const existing = await port.getVisit(input.visitId)
  if (existing) {
    if (existing.tenantId === caller.tenantId && existing.checkIn.securityUserId === caller.uid && existing.vehicleId === input.vehicleId) {
      return { outcome: 'checked_in', visitId: input.visitId, at: existing.checkIn.timestamp, driverName: existing.driverName, plateNo: existing.plateNo }
    }
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }

  // ---- the day's pass and the gate time ----
  const tz = timezoneOf(tenant)
  const open = await openWindowPass(deps, caller.tenantId, input.vehicleId, tz, nowMs)
  if (!open) throw fail('failed-precondition', 'pass-not-checked-in', 'This vehicle has not been checked in today')
  const hours = dwellLimitHoursOf(tenant)
  const firstIn = (open.pass.checkIn as NonNullable<PassData['checkIn']>).at
  if (!withinGateTime(firstIn, nowMs, hours)) {
    throw failWith('failed-precondition', 'gate-time-over', `The ${hours} hour gate time of this vehicle is over`, { since: firstIn, hours })
  }
  const driverId = open.pass.driverId
  const driverUser = await deps.data.getUser(driverId)
  if (!driverUser || driverUser.role !== 'driver' || driverUser.status !== 'active' || driverUser.tenantId !== caller.tenantId) {
    throw fail('failed-precondition', 'driver-inactive', 'This driver is disabled')
  }

  // ---- vehicle and contractor must be active ----
  if (vehicle.status !== 'active') throw fail('failed-precondition', 'vehicle-suspended', 'This vehicle is suspended')
  const contractor = await deps.data.getContractor(vehicle.contractorId)
  if (!contractor || contractor.tenantId !== caller.tenantId || contractor.status !== 'active') {
    throw fail('failed-precondition', 'contractor-suspended', 'This contractor is suspended')
  }

  // ---- eligibility: the combined Module 2-4 check, consumed as it is, minus the safety inspection: the vehicle was
  // inspected (or let in) at its first entry of the day and a vehicle makes several trips, so it is not inspected again ----
  const eligibility = await evaluateEligibility(deps, caller.tenantId, { vehicleId: input.vehicleId, driverId })
  if (!eligibleWithoutInspection(eligibility)) {
    await deps.data
      .writeAudit(
        makeAudit(caller, 'visit.checkInBlocked', input.visitId, { vehicleId: input.vehicleId, driverId, status: eligibility.status }, 'visit'),
      )
      .catch(() => undefined)
    return { outcome: 'blocked', driverName: driverUser.name, plateNo: vehicle.plateNo, eligibility }
  }

  // ---- the monthly gate pass: the last gate, after eligibility. Only an ACTIVE pass of this month lets the vehicle in ----
  const gatePass = await checkGatePassForCheckIn(port, tenant, caller.tenantId, input.vehicleId, driverId, nowMs)
  if (gatePass.state !== 'active') {
    await deps.data
      .writeAudit(
        makeAudit(
          caller,
          'visit.checkInBlocked',
          input.visitId,
          { vehicleId: input.vehicleId, driverId, gatePass: gatePass.state, gatePassReason: gatePass.state === 'blocked' ? gatePass.reason : null },
          'visit',
        ),
      )
      .catch(() => undefined)
    return { outcome: 'no_gate_pass', driverName: driverUser.name, plateNo: vehicle.plateNo, gatePass }
  }

  const dateKey = computeDateKey(tz, new Date(nowMs))
  const planned = await port.checkInTx({
    visitId: input.visitId,
    tenantId: caller.tenantId,
    vehicleId: input.vehicleId,
    driverId,
    plan: (ctx) =>
      planVisitCheckIn(
        { caller, actorName: actor.name, visitId: input.visitId, requestId: input.requestId, vehicle: withId, passId: open.id, driverId, gate, dateKey, nowMs },
        ctx,
      ),
  })
  const stored = planned.visit
  return { outcome: 'checked_in', visitId: input.visitId, at: stored.checkIn.timestamp, driverName: stored.driverName, plateNo: stored.plateNo }
}

// ---- checkOutVisit ---------------------------------------------------------------------------

export interface CheckOutVisitResult {
  visitId: string
  at: number
  /** True when the Yard Officer has not logged the unloading check for this visit (informational only). */
  unloadingMissing: boolean
}

/** Pure: decides a check-out. No eligibility is checked on the way out. */
export function planVisitCheckOut(
  i: { caller: Caller; actorName: string; visitId: string; requestId: string; dateKey: string; nowMs: number },
  visit: VisitRecord | null,
): CheckOutPlan {
  const v = ownVisit(visit, i.caller.tenantId)
  if (v.status === 'checked_out') {
    if (v.checkOut?.requestId === i.requestId) return { kind: 'replay', visit: v }
    throw failWith('already-exists', 'visit-checked-out', 'This vehicle has already left', {
      byName: v.checkOut?.securityUserName ?? null,
      at: v.checkOut?.timestamp ?? null,
    })
  }
  return {
    kind: 'write',
    checkOut: { timestamp: i.nowMs, dateKey: i.dateKey, securityUserId: i.caller.uid, securityUserName: i.actorName, requestId: i.requestId },
    audit: makeAudit(i.caller, 'visit.checkOut', i.visitId, { vehicleId: v.vehicleId, driverId: v.driverId, unloaded: v.unloadingCheck?.unloaded ?? null }, 'visit'),
  }
}

export async function checkOutVisit(deps: Deps, port: VisitPort, caller: Caller, raw: unknown): Promise<CheckOutVisitResult> {
  const input = parse(checkOutVisitSchema, raw)
  requireCan(caller, 'visit.checkOut')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const dateKey = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  let unloadingMissing = false
  const planned = await port.checkOutTx({
    visitId: input.visitId,
    plan: (visit) => {
      const p = planVisitCheckOut({ caller, actorName: actor.name, visitId: input.visitId, requestId: input.requestId, dateKey, nowMs }, visit)
      unloadingMissing = visit !== null && visit.unloadingCheck === null
      return p
    },
  })
  const at = planned.kind === 'write' ? planned.checkOut.timestamp : (planned.visit.checkOut?.timestamp ?? nowMs)
  return { visitId: input.visitId, at, unloadingMissing }
}

// ---- logUnloadingCheck (Yard Officer) -----------------------------------------------------------

/** Pure: decides an unloading check on a visit that is still checked in. */
export function planUnloading(
  i: { caller: Caller; actorName: string; visitId: string; unloaded: boolean; unloadLocation: string | null; dateKey: string; nowMs: number },
  visit: VisitRecord | null,
): UnloadPlan {
  const v = ownVisit(visit, i.caller.tenantId)
  if (v.status !== 'checked_in') throw fail('failed-precondition', 'visit-not-active', 'This vehicle has already left')
  return {
    unloadingCheck: {
      performed: true,
      timestamp: i.nowMs,
      dateKey: i.dateKey,
      officerUserId: i.caller.uid,
      officerName: i.actorName,
      unloaded: i.unloaded,
      unloadLocation: i.unloaded ? i.unloadLocation : null,
    },
    audit: makeAudit(
      i.caller,
      v.unloadingCheck ? 'visit.unloadingUpdate' : 'visit.unloadingCheck',
      i.visitId,
      { vehicleId: v.vehicleId, unloaded: i.unloaded },
      'visit',
    ),
  }
}

export async function logUnloadingCheck(deps: Deps, port: VisitPort, caller: Caller, raw: unknown): Promise<{ visitId: string; at: number }> {
  const input = parse(logUnloadingCheckSchema, raw)
  requireCan(caller, 'visit.unloadingCheck')
  const actor = await requireActiveCaller(deps, caller)
  // "Unloaded: yes" needs a place; "no" never has one.
  if (input.unloaded && !input.unloadLocation) throw fail('invalid-argument', 'unload-location-required', 'Say where it was unloaded')
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const dateKey = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  const planned = await port.unloadTx({
    visitId: input.visitId,
    plan: (visit) =>
      planUnloading(
        { caller, actorName: actor.name, visitId: input.visitId, unloaded: input.unloaded, unloadLocation: input.unloadLocation ?? null, dateKey, nowMs },
        visit,
      ),
  })
  return { visitId: input.visitId, at: planned.unloadingCheck.timestamp }
}

// ---- getDailySummary ---------------------------------------------------------------------------

export interface DwellItem {
  visitId: string
  plateNo: string
  driverName: string
  checkInAt: number
  /** Whole hours on site at the time of the call. */
  hours: number
}

export interface DailySummary {
  /** `YYYYMMDD` in the company's timezone. */
  dateKey: string
  generatedAt: number
  dwellLimitHours: number
  /** Only the tiles this role may see (`summaryMetricsFor`). */
  tiles: Partial<Record<SummaryMetric, number>>
  /** Visits flagged by the dwell job and still on site (only for roles that see `dwellWarnings`). */
  dwell: DwellItem[]
}

const DWELL_LIST_LIMIT = 50

/** `[start, end]` instants (ms, inclusive) of calendar day `dateKey` in `timezone`. */
export function dayBoundsMs(timezone: string, dateKey: string): { from: number; to: number } {
  const iso = isoFromDateKey(dateKey)
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  return { from: endOfDayMs(timezone, prev) + 1, to: endOfDayMs(timezone, iso) }
}

/** Counts only (plus the dwell list), filtered by role on the server: the same function serves every role's screen. */
export async function getDailySummary(deps: Deps, port: VisitPort, caller: Caller): Promise<DailySummary> {
  requireCan(caller, 'visit.summary')
  await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const tz = timezoneOf(tenant)
  const today = computeDateKey(tz, new Date(nowMs))
  const scope: VisitScope = { tenantId: caller.tenantId, contractorId: caller.role === 'supervisor' ? caller.contractorId : null }
  if (caller.role === 'supervisor' && !scope.contractorId) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  const metrics = summaryMetricsFor(caller.role)
  const { from, to } = dayBoundsMs(tz, today)

  const counters: Record<SummaryMetric, () => Promise<number>> = {
    checkIns: () => port.countStage(scope, 'checkIn', today),
    unloads: () => port.countStage(scope, 'unloadingCheck', today),
    checkOuts: () => port.countStage(scope, 'checkOut', today),
    onSite: () => port.countActive(scope, { awaitingUnload: false }),
    awaitingUnload: () => port.countActive(scope, { awaitingUnload: true }),
    suspensions: () => port.countPenaltiesIssued(scope, from, to),
    dwellWarnings: async () => 0, // filled from the list below
  }
  const wanted = metrics.filter((m) => m !== 'dwellWarnings')
  // One failing query (e.g. an index that is not deployed yet) must not blank the whole screen: that tile is left out
  // and the cause is logged by metric. Only when nothing at all could be counted does the call fail.
  const logCtx = { fn: 'getDailySummary', uid: caller.uid, tenantId: caller.tenantId }
  const settled = await Promise.allSettled(wanted.map((m) => counters[m]()))
  const tiles: DailySummary['tiles'] = {}
  let firstError: unknown = null
  let failures = 0
  settled.forEach((r, i) => {
    const metric = wanted[i] as SummaryMetric
    if (r.status === 'fulfilled') {
      tiles[metric] = r.value
      return
    }
    failures += 1
    firstError ??= r.reason
    logError(logCtx, r.reason, { metric })
  })

  let dwell: DwellItem[] = []
  if (metrics.includes('dwellWarnings')) {
    try {
      const list = await port.listDwell(scope, DWELL_LIST_LIMIT)
      dwell = list.map((v) => ({
        visitId: v.id,
        plateNo: v.plateNo,
        driverName: v.driverName,
        checkInAt: v.checkIn.timestamp,
        hours: Math.floor((nowMs - v.checkIn.timestamp) / 3_600_000),
      }))
      tiles.dwellWarnings = dwell.length
    } catch (e) {
      failures += 1
      firstError ??= e
      logError(logCtx, e, { metric: 'dwellWarnings' })
    }
  }
  if (failures > 0 && Object.keys(tiles).length === 0) throw firstError
  return { dateKey: today, generatedAt: nowMs, dwellLimitHours: dwellLimitHoursOf(tenant), tiles, dwell }
}
