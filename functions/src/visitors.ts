// Visitor / pedestrian passes: a lightweight pass for people on foot, parallel to (and independent of) the vehicle lifecycle.
// Issue (admin, supervisor) -> check-in -> check-out (Security), with revoke, a lookup and an expiry schedule.
// Clients only read `visitors`, `visitorPasses` and `visitorPassUsage` (rules); every write is one of these callables.
//
// Pure planners decide from what one transaction read (`planIssue`, `planCheckIn`, ...), so a retried or concurrent call can
// never write twice; the Firestore port (visitorsPort.ts) only reads, writes and converts timestamps.
import { randomInt } from 'node:crypto'
import { audit as makeAudit, parse, requireActiveCaller, type Deps } from './core.js'
import { DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { fail, failWith } from './errors.js'
import { gatesOf } from './gates.js'
import { isJpeg } from './passRules.js'
import { normalisePhone } from './credentials.js'
import { can, type Action } from './permissions.js'
import {
  checkInVisitorPassSchema,
  checkOutVisitorPassSchema,
  issueVisitorPassSchema,
  lookupVisitorPassSchema,
  revokeVisitorPassSchema,
  updateVisitorSchema,
  updateVisitorSettingsSchema,
  type IssueVisitorPassInput,
} from './visitorSchemas.js'
import { VISITOR_PASS_ID_PATTERN, visitorPhotoPath } from './ids.js'
import {
  effectiveStatus,
  entryCheck,
  idKeyOf,
  isOverstay,
  monthlyCap,
  normalisePassCode,
  PASS_CODE_ALPHABET,
  PASS_CODE_LENGTH,
  planOf,
  validityWindow,
  visitorQrPayload,
  visitorSettingsOf,
  yearMonthOf,
  type EntryCheck,
  type VisitorPassStatus,
} from './visitorLogic.js'
import type { AuditEntry, Caller, TenantData, VisitorData, VisitorPassData } from './types.js'

// ---- Port (Firestore in production, fakes in tests) ----------------------------------------------

export type VisitorRecord = VisitorData & { id: string }
export type VisitorPassRecord = VisitorPassData & { id: string }

/** What the issue transaction read. */
export interface IssueContext {
  /** `visitorPasses/{passId}` when it already exists (a retry). */
  existingPass: VisitorPassRecord | null
  /** `visitors/{visitorId}` when it exists (a returning visitor). */
  visitor: VisitorRecord | null
  /** Passes already counted this month. */
  used: number
  /** The candidate code is already taken in this company. */
  codeTaken: boolean
}

export type IssuePlan =
  | { kind: 'replay'; pass: VisitorPassRecord }
  | { kind: 'code-taken' }
  | { kind: 'write'; visitor: VisitorData; visitorIsNew: boolean; pass: VisitorPassData; usedAfter: number; audits: AuditEntry[] }

export interface PassPlan {
  patch: Partial<VisitorPassData>
  audit: AuditEntry
}

export interface VisitorPort {
  /**
   * ONE transaction: reads the pass id, the visitor, this month's usage and the code guard, hands them to `plan` (pure; throws
   * HttpsError to refuse) and, for a `write`, creates the pass and the code guard, creates or updates the visitor, raises the
   * usage counter and writes the audit entries together. A retry and two concurrent calls can never count twice.
   */
  issueTx(p: { passId: string; visitorId: string; tenantId: string; month: string; code: string; plan: (ctx: IssueContext) => IssuePlan }): Promise<IssuePlan>
  getPass(passId: string): Promise<VisitorPassRecord | null>
  findPassByCode(tenantId: string, code: string): Promise<VisitorPassRecord | null>
  getVisitor(visitorId: string): Promise<VisitorRecord | null>
  /**
   * ONE transaction: re-reads the pass, hands it to `plan` (pure; throws HttpsError to refuse, returns null to leave it alone)
   * and writes the patch + audit entry together. Two concurrent decisions cannot both write.
   */
  updatePassTx(p: { passId: string; plan: (current: VisitorPassRecord | null) => PassPlan | null }): Promise<{ written: boolean; pass: VisitorPassRecord | null }>
  /** ONE transaction: patches the visitor and the copy on its active and checked-in passes, and writes the audit entry. */
  updateVisitorTx(p: { visitorId: string; tenantId: string; patch: Partial<VisitorData>; audit: AuditEntry }): Promise<void>
  /** Merges the settings into the tenant document and writes the audit entry. */
  updateSettingsTx(p: { tenantId: string; settings: { maxDwellMinutes?: number; defaultValidDays?: number }; audit: AuditEntry }): Promise<void>
  usedThisMonth(tenantId: string, month: string): Promise<number>
  // Schedule
  listTenants(): Promise<{ id: string; data: TenantData }[]>
  /** `active` passes of the tenant whose `validUntil` is before `nowMs`, at most `limit`. */
  listExpired(tenantId: string, nowMs: number, limit: number): Promise<string[]>
  /** One transaction: re-reads each pass and expires only those still `active` and past `validUntil`, plus ONE `system` audit entry. Returns how many. */
  expireTx(tenantId: string, ids: string[], nowMs: number): Promise<number>
  /** Checked-in passes of the tenant not yet flagged (the caller filters by each pass's own limit). */
  listUnflaggedInside(tenantId: string, limit: number): Promise<VisitorPassRecord[]>
  /** One transaction: re-reads each pass and flags only those still checked in, unflagged and over the limit, with an audit entry each. Returns how many. */
  flagTx(tenantId: string, ids: string[], nowMs: number): Promise<number>
}

// ---- Shared helpers -----------------------------------------------------------------------------

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

/** Another company's pass looks exactly like a missing one. */
function ownPass(pass: VisitorPassRecord | null, tenantId: string): VisitorPassRecord {
  if (!pass || pass.tenantId !== tenantId) throw fail('not-found', 'visitor-pass-not-found', 'Visitor pass not found')
  return pass
}

/** A Sri Lankan number is stored as `947XXXXXXXX`; another international number as `+` and its digits. */
export function visitorPhone(input: string): string | null {
  const sl = normalisePhone(input)
  if (sl) return sl
  const digits = input.replace(/[\s\-().]/g, '')
  return /^\+\d{7,18}$/.test(digits) ? digits : null
}

/** A fresh pass code: `PASS_CODE_LENGTH` characters from the unambiguous alphabet. */
export const newPassCode = (): string => Array.from({ length: PASS_CODE_LENGTH }, () => PASS_CODE_ALPHABET[randomInt(PASS_CODE_ALPHABET.length)]).join('')

const MIN_VISITOR_PHOTO_BYTES = 1024
const MAX_VISITOR_PHOTO_BYTES = 1024 * 1024

async function verifyVisitorPhoto(deps: Deps, path: string): Promise<void> {
  const stored = await deps.storage.readFile(path, 4)
  if (!stored) throw fail('failed-precondition', 'photo-missing', 'The photo was not uploaded')
  if (stored.contentType !== 'image/jpeg' || !isJpeg(stored.head)) throw fail('failed-precondition', 'evidence-invalid', 'The photo is not a JPEG')
  if (stored.size < MIN_VISITOR_PHOTO_BYTES || stored.size > MAX_VISITOR_PHOTO_BYTES) throw fail('failed-precondition', 'evidence-invalid', 'The photo has an unacceptable size')
}

const emptyToNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

const MAX_CODE_ATTEMPTS = 6

// ---- issueVisitorPass ------------------------------------------------------------------------------

export interface IssueResult {
  passId: string
  visitorId: string
  passCode: string
  /** The content of the QR: the app address plus the code, never a name or a number. */
  qrPayload: string
  validFrom: number
  validUntil: number
  siteId: string
  siteName: string
  /** Passes counted this month after this one, and the plan's cap (`null` = unlimited). */
  used: number
  cap: number | null
  /** False when this call was a retry of one that already went through. */
  created: boolean
}

interface IssuePlanInput {
  caller: Caller
  actorName: string
  passId: string
  visitorId: string
  input: IssueVisitorPassInput
  phone: string
  photoPath: string | null
  site: { id: string; name: string }
  window: { from: number; until: number }
  month: string
  code: string
  nowMs: number
  tenant: TenantData | null
}

/** Pure: decides an issue from what the transaction read. Throws HttpsError to refuse. */
export function planIssue(i: IssuePlanInput, ctx: IssueContext): IssuePlan {
  const { caller, input } = i
  if (ctx.existingPass) {
    // A retry of a call that already went through: same id, same issuer. Anything else is a clash.
    const e = ctx.existingPass
    if (e.tenantId === caller.tenantId && e.issuedBy.uid === caller.uid && e.visitorId === i.visitorId) return { kind: 'replay', pass: e }
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }
  if (ctx.visitor && ctx.visitor.tenantId !== caller.tenantId) throw fail('not-found', 'visitor-not-found', 'Visitor not found')

  // The plan cap: counted per calendar month in the company timezone, checked and raised in the same transaction.
  const cap = monthlyCap(planOf(i.tenant))
  if (cap !== null && ctx.used >= cap) {
    throw failWith('resource-exhausted', 'plan-limit-reached', 'The monthly visitor pass limit of your plan is reached', { used: ctx.used, cap })
  }
  if (ctx.codeTaken) return { kind: 'code-taken' }

  const settings = visitorSettingsOf(i.tenant)
  const idNumber = emptyToNull(input.visitor.idNumber)
  const organization = emptyToNull(input.visitor.organization)
  const visitor: VisitorData = {
    tenantId: caller.tenantId,
    fullName: input.visitor.fullName,
    phone: i.phone,
    idNumber,
    idKey: idKeyOf(idNumber),
    organization,
    // A photo uploaded now replaces the old one; otherwise the returning visitor keeps theirs.
    photoPath: i.photoPath ?? ctx.visitor?.photoPath ?? null,
    createdAt: ctx.visitor?.createdAt ?? i.nowMs,
    createdBy: ctx.visitor?.createdBy ?? caller.uid,
    updatedAt: i.nowMs,
  }
  const pass: VisitorPassData = {
    tenantId: caller.tenantId,
    visitorId: i.visitorId,
    visitorName: visitor.fullName,
    visitorOrganization: organization,
    hostName: emptyToNull(input.hostName),
    purposeOfVisit: input.purposeOfVisit,
    photoPath: visitor.photoPath,
    siteId: i.site.id,
    siteName: i.site.name,
    passCode: i.code,
    status: 'active',
    month: i.month,
    issuedAt: i.nowMs,
    issuedBy: { uid: caller.uid, name: i.actorName, role: caller.role },
    validFrom: i.window.from,
    validUntil: i.window.until,
    maxDwellMinutes: settings.maxDwellMinutes,
    checkInAt: null,
    checkInBy: null,
    checkInRequestId: null,
    checkOutAt: null,
    checkOutBy: null,
    checkOutRequestId: null,
    dwellWarning: false,
    dwellWarningAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    expiredAt: null,
    notes: (input.notes ?? '').trim(),
  }
  const audits: AuditEntry[] = []
  if (!ctx.visitor) audits.push(makeAudit(caller, 'visitor.create', i.visitorId, {}, 'visitor'))
  audits.push(makeAudit(caller, 'visitorPass.issue', i.passId, { siteId: i.site.id, month: i.month, returning: ctx.visitor !== null }, 'visitorPass'))
  return { kind: 'write', visitor, visitorIsNew: ctx.visitor === null, pass, usedAfter: ctx.used + 1, audits }
}

/**
 * Creates (or reuses) the visitor record, checks this month's usage against the company's plan, creates the pass, raises the
 * usage counter in the same transaction and returns the short pass code and the QR payload. A retry with the same ids
 * returns the stored pass and counts nothing.
 */
export async function issueVisitorPass(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown, baseUrl: string): Promise<IssueResult> {
  const input = parse(issueVisitorPassSchema, raw)
  requireCan(caller, 'visitorPass.issue')
  const actor = await requireActiveCaller(deps, caller)
  const tenant = await deps.data.getTenant(caller.tenantId)
  const tz = timezoneOf(tenant)
  const nowMs = deps.now() * 1000

  const gates = gatesOf(tenant)
  const site = input.siteId ? gates.find((g) => g.id === input.siteId) : gates[0]
  if (!site) throw fail('invalid-argument', 'gate-invalid', 'Unknown site')
  const settings = visitorSettingsOf(tenant)
  const window = validityWindow(tz, nowMs, { validFrom: input.validFrom, validUntil: input.validUntil }, settings.defaultValidDays)
  if (!window.ok) throw fail('invalid-argument', 'invalid-window', 'The validity dates are not allowed')
  const phone = visitorPhone(input.visitor.phone)
  if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')

  let photoPath: string | null = null
  if (input.hasPhoto) {
    photoPath = visitorPhotoPath(caller.tenantId, input.visitorId)
    await verifyVisitorPhoto(deps, photoPath)
  }

  const month = yearMonthOf(tz, new Date(nowMs))
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = newPassCode()
    const planned = await port.issueTx({
      passId: input.passId,
      visitorId: input.visitorId,
      tenantId: caller.tenantId,
      month,
      code,
      plan: (ctx) => planIssue({ caller, actorName: actor.name, passId: input.passId, visitorId: input.visitorId, input, phone, photoPath, site, window, month, code, nowMs, tenant }, ctx),
    })
    if (planned.kind === 'code-taken') continue
    const pass = planned.pass
    const used = planned.kind === 'replay' ? await port.usedThisMonth(caller.tenantId, pass.month) : planned.usedAfter
    return {
      passId: input.passId,
      visitorId: input.visitorId,
      passCode: pass.passCode,
      qrPayload: visitorQrPayload(baseUrl, pass.passCode),
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      siteId: pass.siteId,
      siteName: pass.siteName,
      used,
      cap: monthlyCap(planOf(tenant)),
      created: planned.kind === 'write',
    }
  }
  throw fail('internal', 'internal', 'Could not allocate a pass code')
}

// ---- updateVisitor ---------------------------------------------------------------------------------

/** Edits a visitor record (admin, supervisor). The name, employer and photo shown on their live passes follow. */
export async function updateVisitor(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateVisitorSchema, raw)
  requireCan(caller, 'visitor.manage')
  await requireActiveCaller(deps, caller)
  const visitor = await port.getVisitor(input.visitorId)
  if (!visitor || visitor.tenantId !== caller.tenantId) throw fail('not-found', 'visitor-not-found', 'Visitor not found')
  const patch: Partial<VisitorData> = {}
  if (input.fullName !== undefined) patch.fullName = input.fullName
  if (input.phone !== undefined) {
    const phone = visitorPhone(input.phone)
    if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')
    patch.phone = phone
  }
  if (input.idNumber !== undefined) {
    patch.idNumber = emptyToNull(input.idNumber)
    patch.idKey = idKeyOf(patch.idNumber)
  }
  if (input.organization !== undefined) patch.organization = emptyToNull(input.organization)
  if (input.hasPhoto) {
    patch.photoPath = visitorPhotoPath(caller.tenantId, input.visitorId)
    await verifyVisitorPhoto(deps, patch.photoPath)
  }
  if (Object.keys(patch).length === 0) throw fail('invalid-argument', 'invalid-input', 'Nothing to change')
  await port.updateVisitorTx({
    visitorId: input.visitorId,
    tenantId: caller.tenantId,
    patch,
    audit: makeAudit(caller, 'visitor.update', input.visitorId, { fields: Object.keys(patch).filter((k) => k !== 'idKey').join(',') }, 'visitor'),
  })
  return { ok: true }
}

// ---- revokeVisitorPass -----------------------------------------------------------------------------

/** Pure: only an `active` pass is revoked (a visitor already inside is checked out by Security instead). Replaying a revoke is a no-op. */
export function planRevoke(current: VisitorPassRecord | null, caller: Caller, actorName: string, reason: string | undefined, nowMs: number): PassPlan | null {
  const pass = ownPass(current, caller.tenantId)
  if (pass.status === 'revoked') return null
  if (effectiveStatus(pass, nowMs) !== 'active') throw failWith('failed-precondition', 'pass-not-active', 'Only an active pass can be revoked', { status: effectiveStatus(pass, nowMs) })
  return {
    patch: { status: 'revoked', revokedAt: nowMs, revokedBy: { uid: caller.uid, name: actorName }, revokeReason: emptyToNull(reason) },
    audit: makeAudit(caller, 'visitorPass.revoke', pass.id, {}, 'visitorPass'),
  }
}

export async function revokeVisitorPass(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(revokeVisitorPassSchema, raw)
  requireCan(caller, 'visitorPass.revoke')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  await port.updatePassTx({ passId: input.passId, plan: (current) => planRevoke(current, caller, actor.name, input.reason, nowMs) })
  return { ok: true }
}

// ---- lookupVisitorPass -----------------------------------------------------------------------------

/** What the gate (and the read-only pass view) needs: no phone, no id number. */
export interface VisitorPassView {
  passId: string
  passCode: string
  /** Effective status: an unexpired-by-schedule `active` pass past its end reads `expired`. */
  status: VisitorPassStatus
  /** Can this pass check in right now? */
  entry: EntryCheck
  visitorName: string
  organization: string | null
  hostName: string | null
  purposeOfVisit: string
  photoPath: string | null
  siteId: string
  siteName: string
  validFrom: number
  validUntil: number
  maxDwellMinutes: number
  checkInAt: number | null
  checkInByName: string | null
  checkOutAt: number | null
  overstay: boolean
  revokeReason: string | null
}

export function viewOf(pass: VisitorPassRecord, nowMs: number): VisitorPassView {
  return {
    passId: pass.id,
    passCode: pass.passCode,
    status: effectiveStatus(pass, nowMs),
    entry: entryCheck(pass, nowMs),
    visitorName: pass.visitorName,
    organization: pass.visitorOrganization,
    hostName: pass.hostName,
    purposeOfVisit: pass.purposeOfVisit,
    photoPath: pass.photoPath,
    siteId: pass.siteId,
    siteName: pass.siteName,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    maxDwellMinutes: pass.maxDwellMinutes,
    checkInAt: pass.checkInAt,
    checkInByName: pass.checkInBy?.name ?? null,
    checkOutAt: pass.checkOutAt,
    overstay: isOverstay(pass, nowMs),
    revokeReason: pass.revokeReason,
  }
}

async function resolvePass(port: VisitorPort, tenantId: string, input: { code?: string | undefined; passId?: string | undefined }): Promise<VisitorPassRecord> {
  if (input.passId !== undefined) return ownPass(await port.getPass(input.passId), tenantId)
  const code = normalisePassCode(input.code ?? '')
  // A code that cannot be one of ours looks like one that does not exist: nothing to tell a guesser.
  if (!code) throw fail('not-found', 'visitor-pass-not-found', 'Visitor pass not found')
  return ownPass(await port.findPassByCode(tenantId, code), tenantId)
}

export async function lookupVisitorPass(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<VisitorPassView> {
  const input = parse(lookupVisitorPassSchema, raw)
  requireCan(caller, 'visitorPass.lookup')
  await requireActiveCaller(deps, caller)
  return viewOf(await resolvePass(port, caller.tenantId, input), deps.now() * 1000)
}

// ---- checkInVisitorPass ----------------------------------------------------------------------------

/** Pure: decides a check-in. Throws a specific, typed refusal the Security screen words for the guard. */
export function planCheckIn(current: VisitorPassRecord | null, caller: Caller, actorName: string, siteId: string, requestId: string, nowMs: number): PassPlan | null {
  const pass = ownPass(current, caller.tenantId)
  if (pass.status === 'checked_in') {
    if (pass.checkInRequestId === requestId && pass.checkInBy?.uid === caller.uid) return null // a retry of a call that went through
    throw failWith('already-exists', 'pass-already-checked-in', 'This visitor is already checked in', { byName: pass.checkInBy?.name ?? null, at: pass.checkInAt })
  }
  if (pass.status === 'checked_out') throw failWith('failed-precondition', 'pass-already-checked-out', 'This pass was already used', { at: pass.checkOutAt })
  if (pass.status === 'revoked') throw failWith('failed-precondition', 'pass-revoked', 'This pass was revoked', { reason: pass.revokeReason })
  const entry = entryCheck(pass, nowMs)
  if (entry === 'expired') throw failWith('failed-precondition', 'pass-expired', 'This pass has expired', { validUntil: pass.validUntil })
  if (entry === 'not-yet-valid') throw failWith('failed-precondition', 'pass-not-yet-valid', 'This pass is not valid yet', { validFrom: pass.validFrom })
  if (entry !== 'ok') throw fail('failed-precondition', 'pass-not-active', 'This pass cannot be used')
  if (pass.siteId !== siteId) throw failWith('failed-precondition', 'wrong-site', 'This pass is for another site', { siteName: pass.siteName })
  return {
    patch: { status: 'checked_in', checkInAt: nowMs, checkInBy: { uid: caller.uid, name: actorName }, checkInRequestId: requestId },
    audit: makeAudit(caller, 'visitorPass.checkIn', pass.id, { siteId }, 'visitorPass'),
  }
}

export interface VisitorMovementResult {
  passId: string
  visitorName: string
  at: number
  /** False when this call was a retry of one that already went through. */
  recorded: boolean
}

/**
 * Security checks a visitor in by scanned or typed code (or pass id) at a site. The guard's uid is the caller's, never the
 * client's. Validates: active, inside its validity window, not already checked in, not revoked, for this site. Idempotent
 * on `requestId`.
 */
export async function checkInVisitorPass(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<VisitorMovementResult> {
  const input = parse(checkInVisitorPassSchema, raw)
  requireCan(caller, 'visitorPass.checkIn')
  const actor = await requireActiveCaller(deps, caller)
  const tenant = await deps.data.getTenant(caller.tenantId)
  if (!gatesOf(tenant).some((g) => g.id === input.siteId)) throw fail('invalid-argument', 'gate-invalid', 'Unknown site')
  const found = await resolvePass(port, caller.tenantId, input)
  const nowMs = deps.now() * 1000
  const { pass } = await port.updatePassTx({ passId: found.id, plan: (current) => planCheckIn(current, caller, actor.name, input.siteId, input.requestId, nowMs) })
  const done = ownPass(pass, caller.tenantId)
  return { passId: done.id, visitorName: done.visitorName, at: done.checkInAt ?? nowMs, recorded: done.checkInRequestId === input.requestId }
}

// ---- checkOutVisitorPass ---------------------------------------------------------------------------

/** Pure: only a checked-in pass is checked out. A check-out is always accepted (even past the dwell limit or the validity end). */
export function planCheckOut(current: VisitorPassRecord | null, caller: Caller, actorName: string, requestId: string, nowMs: number): PassPlan | null {
  const pass = ownPass(current, caller.tenantId)
  if (pass.status === 'checked_out') {
    if (pass.checkOutRequestId === requestId && pass.checkOutBy?.uid === caller.uid) return null
    throw failWith('failed-precondition', 'pass-already-checked-out', 'This visitor was already checked out', { at: pass.checkOutAt })
  }
  if (pass.status !== 'checked_in') throw fail('failed-precondition', 'pass-not-checked-in', 'This visitor is not checked in')
  return {
    patch: { status: 'checked_out', checkOutAt: nowMs, checkOutBy: { uid: caller.uid, name: actorName }, checkOutRequestId: requestId },
    audit: makeAudit(caller, 'visitorPass.checkOut', pass.id, {}, 'visitorPass'),
  }
}

export async function checkOutVisitorPass(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<VisitorMovementResult> {
  const input = parse(checkOutVisitorPassSchema, raw)
  requireCan(caller, 'visitorPass.checkOut')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  if (!VISITOR_PASS_ID_PATTERN.test(input.passId)) throw fail('invalid-argument', 'invalid-input', 'Invalid request')
  const { pass } = await port.updatePassTx({ passId: input.passId, plan: (current) => planCheckOut(current, caller, actor.name, input.requestId, nowMs) })
  const done = ownPass(pass, caller.tenantId)
  return { passId: done.id, visitorName: done.visitorName, at: done.checkOutAt ?? nowMs, recorded: done.checkOutRequestId === input.requestId }
}

// ---- updateVisitorSettings -------------------------------------------------------------------------

/** The company's visitor settings: time inside before the flag, and the default validity of a new pass. */
export async function updateVisitorSettings(deps: Deps, port: VisitorPort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateVisitorSettingsSchema, raw)
  requireCan(caller, 'visitor.settings')
  await requireActiveCaller(deps, caller)
  const settings = {
    ...(input.maxDwellMinutes !== undefined ? { maxDwellMinutes: input.maxDwellMinutes } : {}),
    ...(input.defaultValidDays !== undefined ? { defaultValidDays: input.defaultValidDays } : {}),
  }
  await port.updateSettingsTx({ tenantId: caller.tenantId, settings, audit: makeAudit(caller, 'tenant.settings.update', caller.tenantId, { ...settings, area: 'visitors' }, 'tenant') })
  return { ok: true }
}
