import { audit as makeAudit, parse, requireActiveCaller, type Deps, type DecisionContext, type DecisionPlan } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { DEFAULT_REJECTION_REASONS, OTHER_REASON_ID } from './defaultRejectionReasons.js'
import { fail, type Reason } from './errors.js'
import { findTransition, reviewStageOf, statusForStage, type Action, type Stage } from './passTransitions.js'
import { bulkApproveSchema, decidePassSchema, MIN_REJECTION_NOTE, revokePassSchema } from './schemas.js'
import type { Caller, PassData, PassStatus, RejectionReasonDef, TenantData } from './types.js'

export interface BulkItemResult {
  passId: string
  ok: boolean
  error?: Reason
}

const CHANGED = 'This pass changed. Please review it again.'

const reasonsOf = (tenant: TenantData | null): readonly RejectionReasonDef[] =>
  tenant?.rejectionReasons && tenant.rejectionReasons.length > 0 ? tenant.rejectionReasons : DEFAULT_REJECTION_REASONS

const todayOf = (tenant: TenantData | null, nowMs: number): string => {
  const tz = tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE
  return computeDateKey(tz, new Date(nowMs))
}

/** The text the driver sees on the resubmit screen: the label plus the note ("other" is the note alone). */
export const reasonText = (code: string, label: string, note: string | undefined): string =>
  code === OTHER_REASON_ID ? (note ?? label) : note ? `${label}: ${note}` : label

interface Rejecting {
  reasonCode: string
  label: string
  note: string | undefined
}

/** The reason must exist in the tenant's list and `other` needs a note. Runs before the transaction. */
function resolveReason(tenant: TenantData | null, reasonCode: string | undefined, rawNote: string | undefined): Rejecting {
  const found = reasonsOf(tenant).find((r) => r.id === reasonCode)
  if (!reasonCode || !found) throw fail('invalid-argument', 'reason-invalid', 'Choose a valid reason')
  const note = rawNote && rawNote.length > 0 ? rawNote : undefined
  if (reasonCode === OTHER_REASON_ID && (note?.length ?? 0) < MIN_REJECTION_NOTE) {
    throw fail('invalid-argument', 'note-required', 'Add a short note for this reason')
  }
  return { reasonCode, label: found.label, note }
}

/** Shared by decidePass, bulkApprove and revokePass: tenant, ownership, staleness, day and dependencies. */
function checkPass(
  ctx: DecisionContext | null,
  caller: Caller,
  opts: {
    stage: Stage
    action: Action
    expectedStatus: PassStatus
    expectedAttempt: number | undefined
    today: string
    /** Approve/reject need an active vehicle, contractor and driver; revoke must always work. */
    requireActive: boolean
  },
): PassData {
  if (!ctx) throw fail('not-found', 'pass-not-found', 'Pass not found')
  const { pass } = ctx
  if (pass.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'That pass belongs to a different organisation')
  }
  const move = findTransition(pass.status, opts.action, opts.stage)
  if (opts.stage === 'supervisor' && pass.contractorId !== caller.contractorId) {
    throw fail('permission-denied', 'forbidden', 'This pass belongs to a different contractor')
  }
  if (pass.status === 'checked_in' && opts.action === 'revoke') {
    throw fail('failed-precondition', 'already-checked-in', 'This vehicle is already checked in')
  }
  if (pass.status !== opts.expectedStatus || (opts.expectedAttempt !== undefined && pass.attempt !== opts.expectedAttempt) || !move) {
    throw fail('failed-precondition', 'pass-changed', CHANGED)
  }
  if (!move.roles.includes(caller.role)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  if (pass.dateKey !== opts.today) {
    throw fail('failed-precondition', 'pass-expired', 'This pass is from a previous day and can no longer be decided')
  }
  if (opts.requireActive) {
    if (!ctx.vehicle || ctx.vehicle.tenantId !== caller.tenantId || ctx.vehicle.status !== 'active') {
      throw fail('failed-precondition', 'vehicle-suspended', 'This vehicle is suspended')
    }
    if (!ctx.contractor || ctx.contractor.tenantId !== caller.tenantId || ctx.contractor.status !== 'active') {
      throw fail('failed-precondition', 'contractor-suspended', 'This contractor is suspended')
    }
    if (!ctx.driver || ctx.driver.tenantId !== caller.tenantId || ctx.driver.status !== 'active') {
      throw fail('failed-precondition', 'driver-inactive', 'This driver is disabled')
    }
  }
  return pass
}

/** The review decisions handled here. The gate check-in lives in gate.ts. */
type ReviewStage = Exclude<Stage, 'gate'>
type ReviewAction = Exclude<Action, 'check_in'>

interface DecisionInput {
  caller: Caller
  actorName: string
  stage: ReviewStage
  action: ReviewAction
  passId: string
  expectedStatus: PassStatus
  expectedAttempt: number | undefined
  today: string
  nowMs: number
  requireActive: boolean
  rejecting?: Rejecting
  /** Bulk approval refuses passes with a "No" answer. */
  refuseIssues?: boolean
}

const plan =
  (i: DecisionInput) =>
  (ctx: DecisionContext | null): DecisionPlan => {
    const pass = checkPass(ctx, i.caller, i)
    if (i.refuseIssues && pass.checklist.some((c) => c.answer === 'no')) {
      throw fail('failed-precondition', 'has_issues', 'This pass has checklist issues and must be reviewed one by one')
    }
    const move = findTransition(pass.status, i.action, i.stage)
    if (!move) throw fail('failed-precondition', 'pass-changed', CHANGED)
    const who = { byUid: i.caller.uid, byName: i.actorName, byRole: i.caller.role }
    const entry = { action: i.action, stage: i.stage, ...who, at: i.nowMs, attempt: pass.attempt }
    const base = { passId: i.passId, attempt: pass.attempt, from: pass.status, to: move.to }
    const aud = (action: string, extra: Record<string, string | number | boolean | null> = {}) =>
      makeAudit(i.caller, action, i.passId, { ...base, ...extra }, 'pass')

    if (i.action === 'approve') {
      const stamp = { uid: i.caller.uid, name: i.actorName, at: i.nowMs }
      return {
        update: { status: move.to, ...(i.stage === 'supervisor' ? { supervisor: stamp } : { officer: stamp }), entry },
        audit: aud(`pass.approve.${i.stage}`),
      }
    }
    const r = i.rejecting
    if (!r) throw fail('invalid-argument', 'reason-invalid', 'Choose a valid reason')
    return {
      update: {
        status: move.to,
        rejection: {
          reason: reasonText(r.reasonCode, r.label, r.note),
          reasonCode: r.reasonCode,
          ...(r.note ? { note: r.note } : {}),
          stage: i.stage,
          ...who,
          at: i.nowMs,
        },
        entry,
      },
      audit: aud(i.action === 'revoke' ? 'pass.revoke' : `pass.reject.${i.stage}`, { reasonCode: r.reasonCode }),
    }
  }

// ---- decidePass --------------------------------------------------------------------------------

export async function decidePass(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ passId: string; status: PassStatus; attempt: number }> {
  const input = parse(decidePassSchema, raw)
  const actor = await requireActiveCaller(deps, caller)
  // Admin and every other role have no review stage: they can never approve or reject here.
  const stage = reviewStageOf(caller.role)
  if (!stage) throw fail('permission-denied', 'forbidden', 'Your role cannot approve or reject passes')
  if (input.expectedStatus !== statusForStage(stage)) {
    throw fail('permission-denied', 'wrong-stage', 'This pass is not at your approval step')
  }

  const tenant = await deps.data.getTenant(caller.tenantId)
  const nowMs = deps.now() * 1000
  const rejecting = input.action === 'reject' ? resolveReason(tenant, input.reasonCode, input.note) : undefined

  const done = await deps.data.decidePassTx({
    passId: input.passId,
    plan: plan({
      caller, actorName: actor.name, stage, action: input.action, passId: input.passId,
      expectedStatus: input.expectedStatus, expectedAttempt: input.expectedAttempt,
      today: todayOf(tenant, nowMs), nowMs, requireActive: true,
      ...(rejecting ? { rejecting } : {}),
    }),
  })
  return { passId: input.passId, status: done.update.status, attempt: input.expectedAttempt }
}

// ---- bulkApprove -------------------------------------------------------------------------------

/** Maps a thrown error to the per-item code. Anything that is not one of our typed errors is `internal`. */
const reasonOf = (e: unknown): Reason => {
  const details = typeof e === 'object' && e !== null && 'details' in e ? (e as { details: unknown }).details : null
  const reason = typeof details === 'object' && details !== null ? (details as { reason?: unknown }).reason : null
  return typeof reason === 'string' ? (reason as Reason) : 'internal'
}

export async function bulkApprove(deps: Deps, caller: Caller, raw: unknown): Promise<{ results: BulkItemResult[] }> {
  const input = parse(bulkApproveSchema, raw)
  const actor = await requireActiveCaller(deps, caller)
  const stage = reviewStageOf(caller.role)
  if (!stage) throw fail('permission-denied', 'forbidden', 'Your role cannot approve passes')

  const tenant = await deps.data.getTenant(caller.tenantId)
  const nowMs = deps.now() * 1000
  const today = todayOf(tenant, nowMs)
  const expectedStatus = statusForStage(stage)

  // One transaction per item, so one failure never fails the batch.
  const results: BulkItemResult[] = []
  for (const item of input.items) {
    try {
      await deps.data.decidePassTx({
        passId: item.passId,
        plan: plan({
          caller, actorName: actor.name, stage, action: 'approve', passId: item.passId,
          expectedStatus, expectedAttempt: item.expectedAttempt, today, nowMs, requireActive: true, refuseIssues: true,
        }),
      })
      results.push({ passId: item.passId, ok: true })
    } catch (e) {
      results.push({ passId: item.passId, ok: false, error: reasonOf(e) })
    }
  }
  return { results }
}

// ---- revokePass --------------------------------------------------------------------------------

export async function revokePass(deps: Deps, caller: Caller, raw: unknown): Promise<{ passId: string; status: 'rejected' }> {
  const input = parse(revokePassSchema, raw)
  const actor = await requireActiveCaller(deps, caller)
  if (caller.role !== 'officer' && caller.role !== 'admin') {
    throw fail('permission-denied', 'forbidden', 'Only officers and admins can revoke a pass')
  }
  const tenant = await deps.data.getTenant(caller.tenantId)
  const nowMs = deps.now() * 1000
  const rejecting = resolveReason(tenant, input.reasonCode, input.note)

  await deps.data.decidePassTx({
    passId: input.passId,
    plan: plan({
      caller, actorName: actor.name, stage: 'revoked', action: 'revoke', passId: input.passId,
      expectedStatus: 'officer_approved', expectedAttempt: input.expectedAttempt,
      today: todayOf(tenant, nowMs), nowMs, requireActive: false, rejecting,
    }),
  })
  return { passId: input.passId, status: 'rejected' }
}
