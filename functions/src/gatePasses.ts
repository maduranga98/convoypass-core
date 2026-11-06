// Monthly gate pass: one document per vehicle + driver pairing per calendar month (company timezone). The pass is the last
// gate of the eligibility chain: the check-in asks for it AFTER the combined `evaluateEligibility` (documents, penalties,
// inspection), which is consumed here, never re-derived. Clients only read `gatePasses` (rules); every write is a callable or
// a Firestore trigger / schedule in this module.
//
// An active pass flips to `blocked` the moment a condition fails (inspectionTriggers.ts calls `blockActivePasses`). It never
// comes back by itself: the Company Admin reactivates it, and only after the eligibility check passes again. A pass whose
// month has ended becomes `expired` (normal end of cycle, not a flagged problem).
import { evaluateEligibility, type EligibilityResult } from './checkEligibility.js'
import { parse, requireActiveCaller, type Deps } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { fail, failWith, type Reason } from './errors.js'
import {
  gatePassCheck,
  gatePassId,
  inQualificationWindow,
  isBlockable,
  isReactivatable,
  issuableMonths,
  monthOfDateKey,
  nextMonth,
  pairingKey,
  type BlockReason,
  type GatePassCheck,
  type GatePassData,
  type GatePassRecord,
  type QualificationEntry,
  type QualificationMeta,
} from './gatePassLogic.js'
import { logError, logInfo } from './logger.js'
import { can, type Action } from './permissions.js'
import { blockGatePassSchema, issueGatePassesSchema, reactivateGatePassSchema, refreshQualificationSchema } from './schemas.js'
import type { AuditEntry, Caller, TenantData, VehicleData } from './types.js'

// ---- Port (Firestore in production, fakes in tests) ----------------------------------------------

/** What a transaction changes on a pass. Times are milliseconds; the port converts them. */
export type GatePassPatch = Partial<Omit<GatePassData, 'tenantId' | 'vehicleId' | 'driverId' | 'month'>>

export interface GatePassPlan {
  patch: GatePassPatch
  audit: AuditEntry
}

/** An active vehicle of an active contractor and an active driver assigned to it. */
export interface CandidatePair {
  vehicleId: string
  driverId: string
  contractorId: string
  contractorName: string
  plateNo: string
  driverName: string
}

export interface GatePassPort {
  getPass(passId: string): Promise<GatePassRecord | null>
  /** The pairing's pass for `month` (null = none) and whether it ever had a pass for an earlier month. */
  lookupForPairing(tenantId: string, vehicleId: string, driverId: string, month: string): Promise<{ current: GatePassRecord | null; hadEarlier: boolean }>
  /** ONE transaction: `create()` the pass and its audit entry. When it already exists nothing is written and the stored pass comes back. */
  issueTx(p: { passId: string; pass: GatePassData; audit: AuditEntry }): Promise<{ created: boolean; pass: GatePassRecord }>
  /**
   * ONE transaction: re-reads the pass, hands it to `plan` (pure; throws HttpsError to refuse, returns null to leave it
   * alone) and writes the patch + audit entry together. Two concurrent decisions cannot both write.
   */
  updateTx(p: { passId: string; plan: (current: GatePassRecord | null) => GatePassPlan | null }): Promise<{ written: boolean; pass: GatePassRecord | null }>
  /** Active passes of the tenant for a vehicle and/or a driver (any month). */
  listActive(tenantId: string, scope: { vehicleId?: string; driverId?: string }): Promise<GatePassRecord[]>
  listTenants(): Promise<{ id: string; data: TenantData }[]>
  /** Ids of the tenant's `active` or `blocked` passes of a month before `currentMonth`, at most `limit`. */
  listOver(tenantId: string, currentMonth: string, limit: number): Promise<string[]>
  /**
   * One transaction: re-reads each pass and expires only those still `active`/`blocked` and before `currentMonth`
   * (keeping `blockedReason`), plus ONE `system` audit entry for the page. Returns how many were expired.
   */
  expireTx(tenantId: string, ids: string[], currentMonth: string, nowMs: number): Promise<number>
  markRollover(tenantId: string, month: string): Promise<void>
  /** Pairings to evaluate, in a stable order, at most `max` (`truncated` = there were more). */
  listCandidatePairs(tenantId: string, max: number): Promise<{ pairs: CandidatePair[]; truncated: boolean }>
  /** `pairingKey` of every pass the tenant has for `month`, whatever its status. */
  listPassKeys(tenantId: string, month: string): Promise<Set<string>>
  /** Replaces the month's list: upserts `entries`, deletes the ones no longer qualified, writes the summary. */
  replaceQualification(tenantId: string, month: string, meta: QualificationMeta, entries: QualificationEntry[]): Promise<void>
  removeQualificationEntries(tenantId: string, month: string, keys: string[]): Promise<void>
}

// ---- Shared helpers --------------------------------------------------------------------------------

const timezoneOf = (tenant: TenantData | null): string => (tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE)

/** The calendar month (`YYYY-MM`) it is right now in the company's timezone. */
export const currentMonthOf = (tenant: TenantData | null, nowMs: number): string => monthOfDateKey(computeDateKey(timezoneOf(tenant), new Date(nowMs)))

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

/** Runs `fn` over `items` with at most `size` in flight, keeping the order of results. */
export async function mapPool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T)
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

/** Another tenant's pass looks exactly like a missing one. */
function ownPass(pass: GatePassRecord | null, tenantId: string): GatePassRecord {
  if (!pass || pass.tenantId !== tenantId) throw fail('not-found', 'gate-pass-not-found', 'Gate pass not found')
  return pass
}

const systemActor = { uid: 'system', name: 'ConvoyPass' }

const passAudit = (tenantId: string, action: string, passId: string, actor: { uid: string; role: string }, meta: AuditEntry['meta']): AuditEntry => ({
  tenantId,
  action,
  actorUid: actor.uid,
  actorRole: actor.role as AuditEntry['actorRole'],
  targetType: 'gatePass',
  targetId: passId,
  meta,
})

/** Words for what is still wrong, from the shared eligibility output (codes, never names): used by reactivation and the UI. */
export function unresolvedReasons(e: EligibilityResult): string[] {
  const out: string[] = []
  if (e.vehicle?.blocked || e.driver?.blocked) out.push('penalty')
  if (e.vehicle?.documentStatus === 'expired' || e.driver?.documentStatus === 'expired') out.push('document_expired')
  if (e.inspection && !e.inspection.cleared) out.push('inspection_invalidated')
  if (e.vehicle?.annualInspection && e.vehicle.annualInspection !== 'valid' && e.vehicle.annualInspection !== 'expiringSoon') out.push('annual_inspection')
  if (e.driver?.qualifications && !e.driver.qualifications.ok) out.push('qualification')
  return out
}

// ---- Pairing validation ------------------------------------------------------------------------------

interface ValidPairing {
  vehicle: VehicleData & { id: string }
  driverName: string
}

/** Everything that must hold for a pass to exist at all (not eligibility): same tenant, assigned, active vehicle, contractor and driver. */
async function validatePairing(deps: Deps, tenantId: string, vehicleId: string, driverId: string): Promise<ValidPairing | Reason> {
  const vehicle = await deps.data.getVehicle(vehicleId)
  if (!vehicle || vehicle.tenantId !== tenantId) return 'vehicle-not-found'
  if (!vehicle.assignedDriverIds.includes(driverId)) return 'driver-not-assigned'
  if (vehicle.status !== 'active') return 'vehicle-suspended'
  const [contractor, driver] = await Promise.all([deps.data.getContractor(vehicle.contractorId), deps.data.getUser(driverId)])
  if (!contractor || contractor.tenantId !== tenantId || contractor.status !== 'active') return 'contractor-suspended'
  if (!driver || driver.tenantId !== tenantId || driver.role !== 'driver') return 'user-not-found'
  if (driver.status !== 'active') return 'driver-inactive'
  return { vehicle: { ...vehicle, id: vehicleId }, driverName: driver.name }
}

// ---- Issue -----------------------------------------------------------------------------------------------

export interface IssueResult {
  vehicleId: string
  driverId: string
  ok: boolean
  passId?: string
  /** True when an active pass for the pairing and month already existed (a retry): nothing was written. */
  existing?: boolean
  error?: Reason
}

interface IssueContext {
  tenantId: string
  month: string
  nowMs: number
  actor: { uid: string; name: string; role: string }
  mode: 'manual' | 'auto'
  /** The pairing was evaluated minutes ago by the qualification computation: skip the second eligibility read. */
  verified: boolean
}

async function issueOne(deps: Deps, port: GatePassPort, c: IssueContext, pair: { vehicleId: string; driverId: string }): Promise<IssueResult> {
  const base = { vehicleId: pair.vehicleId, driverId: pair.driverId }
  try {
    const valid = await validatePairing(deps, c.tenantId, pair.vehicleId, pair.driverId)
    if (typeof valid === 'string') return { ...base, ok: false, error: valid }
    if (!c.verified) {
      const e = await evaluateEligibility(deps, c.tenantId, pair)
      if (!e.eligible) return { ...base, ok: false, error: 'not-eligible' }
    }
    const passId = gatePassId(c.month, pair.vehicleId, pair.driverId)
    const pass: GatePassData = {
      tenantId: c.tenantId,
      vehicleId: pair.vehicleId,
      driverId: pair.driverId,
      contractorId: valid.vehicle.contractorId,
      plateNo: valid.vehicle.plateNo,
      driverName: valid.driverName,
      month: c.month,
      status: 'active',
      issuedAt: c.nowMs,
      issuedBy: { uid: c.actor.uid, name: c.actor.name },
      issueMode: c.mode,
      blockedReason: null,
      blockedAt: null,
      blockNote: null,
      reactivation: null,
      expiredAt: null,
    }
    const { created, pass: stored } = await port.issueTx({
      passId,
      pass,
      audit: passAudit(c.tenantId, 'gatePass.issue', passId, c.actor, { vehicleId: pair.vehicleId, driverId: pair.driverId, month: c.month, mode: c.mode }),
    })
    if (!created && stored.status !== 'active') return { ...base, ok: false, passId, error: 'gate-pass-exists' }
    return { ...base, ok: true, passId, ...(created ? {} : { existing: true }) }
  } catch (e) {
    logError({ fn: 'issueGatePass', tenantId: c.tenantId }, e, { step: 'pair' })
    return { ...base, ok: false, error: 'internal' }
  }
}

/**
 * `issueGatePasses({ month, pairs })`: Company Admin only. Each pairing is checked on its own (assigned, active, eligible NOW)
 * and issued in its own transaction, so one failure never fails the batch. A retry is safe: the pass id is the pairing.
 */
export async function issueGatePasses(deps: Deps, port: GatePassPort, caller: Caller, raw: unknown): Promise<{ results: IssueResult[]; issued: number }> {
  const input = parse(issueGatePassesSchema, raw)
  requireCan(caller, 'gatePass.issue')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  if (!issuableMonths(currentMonthOf(tenant, nowMs)).includes(input.month)) throw fail('invalid-argument', 'month-invalid', 'Choose this month or next month')

  const seen = new Set<string>()
  const pairs = input.pairs.filter((p) => !seen.has(pairingKey(p.vehicleId, p.driverId)) && !!seen.add(pairingKey(p.vehicleId, p.driverId)))
  const ctx: IssueContext = { tenantId: caller.tenantId, month: input.month, nowMs, actor: { uid: caller.uid, name: actor.name, role: caller.role }, mode: 'manual', verified: false }
  const results = await mapPool(pairs, 8, (p) => issueOne(deps, port, ctx, p))
  const issued = results.filter((r) => r.ok)
  // The list shows what is still open: what was just issued (or was already) leaves it.
  if (issued.length > 0) await port.removeQualificationEntries(caller.tenantId, input.month, issued.map((r) => pairingKey(r.vehicleId, r.driverId))).catch((e: unknown) => logError({ fn: 'issueGatePasses', tenantId: caller.tenantId }, e, { step: 'list' }))
  logInfo({ fn: 'issueGatePasses', tenantId: caller.tenantId, uid: caller.uid }, 'ok', { requested: pairs.length, issued: issued.length })
  return { results, issued: issued.length }
}

// ---- Block (admin) and reactivate -----------------------------------------------------------------------

/** `blockGatePass({ passId, note })`: the Company Admin stops an active pass on purpose. A note says why. */
export async function blockGatePass(deps: Deps, port: GatePassPort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(blockGatePassSchema, raw)
  requireCan(caller, 'gatePass.block')
  await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const currentMonth = currentMonthOf(await deps.data.getTenant(caller.tenantId), nowMs)
  await port.updateTx({
    passId: input.passId,
    plan: (cur) => {
      const pass = ownPass(cur, caller.tenantId)
      if (pass.status === 'blocked') return null // a repeated click: already done
      if (!isBlockable(pass, currentMonth)) throw fail('failed-precondition', pass.status === 'expired' || pass.month < currentMonth ? 'gate-pass-over' : 'gate-pass-not-active', 'Only an active pass can be blocked')
      return {
        patch: { status: 'blocked', blockedReason: 'manual', blockedAt: nowMs, blockNote: input.note },
        audit: passAudit(caller.tenantId, 'gatePass.block', input.passId, { uid: caller.uid, role: caller.role }, { reason: 'manual', month: pass.month }),
      }
    },
  })
  return { ok: true }
}

/**
 * `reactivateGatePass({ passId })`: the Company Admin brings a blocked pass back. Never automatic, and never blind: the shared
 * eligibility check (documents, penalties, the vehicle's inspection) must pass NOW, and the vehicle, contractor and driver must
 * be active. Otherwise `failed-precondition` / `issue-unresolved` names what is still wrong.
 */
export async function reactivateGatePass(deps: Deps, port: GatePassPort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(reactivateGatePassSchema, raw)
  requireCan(caller, 'gatePass.reactivate')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const currentMonth = currentMonthOf(await deps.data.getTenant(caller.tenantId), nowMs)
  const pass = ownPass(await port.getPass(input.passId), caller.tenantId)
  if (pass.status === 'active') return { ok: true } // a repeated click
  if (pass.status === 'expired' || pass.month < currentMonth) throw fail('failed-precondition', 'gate-pass-over', 'This pass belongs to a month that has ended')
  if (!isReactivatable(pass, currentMonth)) throw fail('failed-precondition', 'gate-pass-not-blocked', 'This pass is not blocked')

  const valid = await validatePairing(deps, caller.tenantId, pass.vehicleId, pass.driverId)
  if (typeof valid === 'string') throw fail('failed-precondition', valid, 'The vehicle, driver or contractor is not active')
  const eligibility = await evaluateEligibility(deps, caller.tenantId, { vehicleId: pass.vehicleId, driverId: pass.driverId })
  if (!eligibility.eligible) {
    throw failWith('failed-precondition', 'issue-unresolved', 'The problem behind the block is not resolved yet', { causes: unresolvedReasons(eligibility).join(',') })
  }
  await port.updateTx({
    passId: input.passId,
    plan: (cur) => {
      const p = ownPass(cur, caller.tenantId)
      if (p.status === 'active') return null
      if (!isReactivatable(p, currentMonth)) throw fail('failed-precondition', 'gate-pass-not-blocked', 'This pass is not blocked')
      return {
        patch: {
          status: 'active',
          blockedReason: null,
          blockedAt: null,
          blockNote: null,
          reactivation: { by: { uid: caller.uid, name: actor.name }, at: nowMs, previousReason: p.blockedReason },
        },
        audit: passAudit(caller.tenantId, 'gatePass.reactivate', input.passId, { uid: caller.uid, role: caller.role }, { previousReason: p.blockedReason, month: p.month }),
      }
    },
  })
  return { ok: true }
}

// ---- System block (called by the Module 4 triggers) -----------------------------------------------------

export interface BlockRequest {
  tenantId: string
  scope: { vehicleId?: string; driverId?: string }
  reason: BlockReason
  /** What caused it (a penalty id, `vehicle`, `driver:<uid>`, `clearance`): kept in the audit entry, never a name. */
  source: string
  nowMs: number
  currentMonth: string
}

/**
 * Flips every active pass of the vehicle and/or driver (this month or later) to `blocked`. Idempotent: a pass that is already
 * blocked (by whichever cause came first) keeps its reason, so a second trigger changes nothing. Every pass is tried; if one
 * failed the first error is thrown afterwards so the trigger retries.
 */
export async function blockActivePasses(port: GatePassPort, r: BlockRequest): Promise<{ matched: number; blocked: number }> {
  const summary = { matched: 0, blocked: 0 }
  const active = (await port.listActive(r.tenantId, r.scope)).filter((p) => isBlockable(p, r.currentMonth))
  let firstError: unknown
  for (const p of active) {
    summary.matched++
    try {
      const outcome = await port.updateTx({
        passId: p.id,
        plan: (cur) => {
          if (!cur || cur.tenantId !== r.tenantId || !isBlockable(cur, r.currentMonth)) return null
          return {
            patch: { status: 'blocked', blockedReason: r.reason, blockedAt: r.nowMs, blockNote: null },
            audit: passAudit(r.tenantId, 'gatePass.block', p.id, { uid: 'system', role: 'system' }, { reason: r.reason, source: r.source, month: cur.month }),
          }
        },
      })
      if (outcome.written) summary.blocked++
    } catch (e) {
      firstError ??= e
      logError({ fn: 'blockGatePasses', tenantId: r.tenantId }, e, { step: 'pass' })
    }
  }
  if (firstError) throw firstError
  logInfo({ fn: 'blockGatePasses', tenantId: r.tenantId }, 'ok', { reason: r.reason, ...summary })
  return summary
}

// ---- Check-in lookup ------------------------------------------------------------------------------------

/** What the gate needs for one pairing: `active`, or why not. The check-in function calls this after the eligibility check. */
export async function checkGatePassForCheckIn(port: Pick<GatePassPort, 'lookupForPairing'>, tenant: TenantData | null, tenantId: string, vehicleId: string, driverId: string, nowMs: number): Promise<GatePassCheck> {
  const month = currentMonthOf(tenant, nowMs)
  const { current, hadEarlier } = await port.lookupForPairing(tenantId, vehicleId, driverId, month)
  return gatePassCheck(current, hadEarlier, month)
}

// ---- Month rollover: expiry, then the optional automatic issue -------------------------------------------

export const EXPIRY_PAGE_SIZE = 200

export interface RolloverSummary {
  tenants: number
  expired: number
  autoIssued: number
  failedTenants: number
}

/**
 * Runs often (every few minutes). A tenant whose month already rolled over is skipped from one read of its own document, so
 * the work happens once per tenant per month, right after midnight in ITS timezone. Expiry first (pages of 200), then, only when
 * the company switched it on, the automatic issue. A failure leaves the month unmarked and the next run continues (idempotent).
 */
export async function rolloverGatePasses(deps: Deps, port: GatePassPort, nowMs: number, maxPages = 25): Promise<RolloverSummary> {
  const summary: RolloverSummary = { tenants: 0, expired: 0, autoIssued: 0, failedTenants: 0 }
  for (const tenant of await port.listTenants()) {
    const currentMonth = currentMonthOf(tenant.data, nowMs)
    if (tenant.data.gatePassRolloverMonth === currentMonth) continue
    summary.tenants++
    try {
      for (let page = 0; page < maxPages; page++) {
        const ids = await port.listOver(tenant.id, currentMonth, EXPIRY_PAGE_SIZE)
        if (ids.length === 0) break
        const n = await port.expireTx(tenant.id, ids, currentMonth, nowMs)
        summary.expired += n
        if (n === 0 || ids.length < EXPIRY_PAGE_SIZE) break
      }
      if (tenant.data.autoIssueGatePasses === true) {
        const { issued } = await autoIssueGatePasses(deps, port, tenant.id, currentMonth, nowMs)
        summary.autoIssued += issued
      }
      await port.markRollover(tenant.id, currentMonth)
    } catch (e) {
      summary.failedTenants++
      logError({ fn: 'rolloverGatePasses', tenantId: tenant.id }, e)
    }
  }
  logInfo({ fn: 'rolloverGatePasses' }, 'ok', { ...summary })
  return summary
}

// ---- Month-end qualification list -----------------------------------------------------------------------

/** Pairings read per computation. Above it the list says `truncated` instead of silently dropping people. */
export const QUALIFICATION_MAX_PAIRS = 3000

/**
 * Computes who qualifies for `month`: every active vehicle + assigned driver pairing (active contractor and driver) with NO pass
 * for the month yet that the shared `evaluateEligibility` calls eligible (documents not expired, no active penalty, vehicle
 * cleared). Written to `monthEndQualification` so the screen opens fast; nothing is computed on page load.
 */
export async function computeQualification(deps: Deps, port: GatePassPort, tenantId: string, month: string, nowMs: number, trigger: QualificationMeta['trigger']): Promise<{ meta: QualificationMeta; entries: QualificationEntry[] }> {
  const [{ pairs, truncated }, passKeys] = await Promise.all([port.listCandidatePairs(tenantId, QUALIFICATION_MAX_PAIRS), port.listPassKeys(tenantId, month)])
  const open = pairs.filter((p) => !passKeys.has(pairingKey(p.vehicleId, p.driverId)))
  let notEligible = 0
  let failed = 0
  const entries: QualificationEntry[] = []
  const checked = await mapPool(open, 10, async (p) => {
    try {
      return { p, e: await evaluateEligibility(deps, tenantId, { vehicleId: p.vehicleId, driverId: p.driverId }) }
    } catch (err) {
      logError({ fn: 'computeQualification', tenantId }, err, { step: 'pair' })
      return { p, e: null }
    }
  })
  for (const { p, e } of checked) {
    if (!e) failed++
    else if (!e.eligible) notEligible++
    else
      entries.push({
        tenantId,
        month,
        vehicleId: p.vehicleId,
        driverId: p.driverId,
        contractorId: p.contractorId,
        contractorName: p.contractorName,
        plateNo: p.plateNo,
        driverName: p.driverName,
        documentStatus: e.status === 'expiringSoon' ? 'expiringSoon' : 'valid',
        computedAt: nowMs,
      })
  }
  const meta: QualificationMeta = {
    tenantId,
    month,
    computedAt: nowMs,
    trigger,
    evaluatedCount: pairs.length,
    qualifiedCount: entries.length,
    alreadyIssuedCount: pairs.length - open.length,
    notEligibleCount: notEligible,
    failedCount: failed,
    truncated,
  }
  await port.replaceQualification(tenantId, month, meta, entries)
  logInfo({ fn: 'computeQualification', tenantId }, 'ok', { month, trigger, qualified: entries.length, notEligible, failed })
  return { meta, entries }
}

/** `refreshQualificationList({ month })`: the Company Admin recomputes the list now (also how a company starts the first month). */
export async function refreshQualificationList(deps: Deps, port: GatePassPort, caller: Caller, raw: unknown): Promise<QualificationMeta> {
  const input = parse(refreshQualificationSchema, raw)
  requireCan(caller, 'gatePass.qualification.refresh')
  await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  if (!issuableMonths(currentMonthOf(tenant, nowMs)).includes(input.month)) throw fail('invalid-argument', 'month-invalid', 'Choose this month or next month')
  return (await computeQualification(deps, port, caller.tenantId, input.month, nowMs, 'manual')).meta
}

export interface QualificationRunSummary {
  tenants: number
  computed: number
  failedTenants: number
}

/** Daily. In the last days of the month (company timezone) recomputes next month's list, so it is ready and current when the admin opens it. */
export async function computeQualificationLists(deps: Deps, port: GatePassPort, nowMs: number): Promise<QualificationRunSummary> {
  const summary: QualificationRunSummary = { tenants: 0, computed: 0, failedTenants: 0 }
  for (const tenant of await port.listTenants()) {
    const key = computeDateKey(timezoneOf(tenant.data), new Date(nowMs))
    if (!inQualificationWindow(key)) continue
    summary.tenants++
    try {
      await computeQualification(deps, port, tenant.id, nextMonth(monthOfDateKey(key)), nowMs, 'schedule')
      summary.computed++
    } catch (e) {
      summary.failedTenants++
      logError({ fn: 'computeQualificationLists', tenantId: tenant.id }, e)
    }
  }
  logInfo({ fn: 'computeQualificationLists' }, 'ok', { ...summary })
  return summary
}

/**
 * The automatic option (off unless `tenants.autoIssueGatePasses`): at month rollover, evaluates the pairings again right now
 * and issues the pass to the whole qualified list. The company's own switch is the only authority; nothing else turns it on.
 */
export async function autoIssueGatePasses(deps: Deps, port: GatePassPort, tenantId: string, month: string, nowMs: number): Promise<{ issued: number; failed: number }> {
  const { entries } = await computeQualification(deps, port, tenantId, month, nowMs, 'auto')
  const ctx: IssueContext = { tenantId, month, nowMs, actor: { ...systemActor, role: 'system' }, mode: 'auto', verified: true }
  const results = await mapPool(entries, 8, (e) => issueOne(deps, port, ctx, e))
  const issued = results.filter((r) => r.ok)
  if (issued.length > 0) await port.removeQualificationEntries(tenantId, month, issued.map((r) => pairingKey(r.vehicleId, r.driverId)))
  const failed = results.length - issued.length
  logInfo({ fn: 'autoIssueGatePasses', tenantId }, 'ok', { month, issued: issued.length, failed })
  // A failed pairing (a race with a penalty, say) is not an error of the run: it stays on the list for the admin.
  return { issued: issued.length, failed }
}
