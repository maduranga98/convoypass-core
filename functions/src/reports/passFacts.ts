// Facts derived from one pass, shared by several reports.
import { STAGE_LABELS, type ReportPass } from './types.js'

const latest = (pass: ReportPass) => (pass.history ?? []).filter((h) => h.attempt === pass.attempt)

/**
 * When the LATEST attempt reached each stage (milliseconds). Earlier attempts are ignored for timing. Uses the
 * decision `history`; passes that predate it fall back to the stored stamps.
 */
export interface StageTimes {
  submitted: number | null
  supervisor: number | null
  officer: number | null
  checkIn: number | null
}

export function stageTimes(pass: ReportPass): StageTimes {
  const entries = latest(pass)
  const at = (stage: string, action: string): number | null =>
    entries.find((h) => h.stage === stage && h.action === action)?.at ?? null
  return {
    submitted: pass.submittedAt,
    supervisor: at('supervisor', 'approve') ?? pass.supervisor?.at ?? null,
    officer: at('officer', 'approve') ?? pass.officer?.at ?? null,
    checkIn: at('gate', 'check_in') ?? pass.checkIn?.at ?? null,
  }
}

export const reachedSupervisor = (p: ReportPass): boolean =>
  p.status === 'supervisor_approved' ||
  p.status === 'officer_approved' ||
  p.status === 'checked_in' ||
  (p.history ?? []).some((h) => h.action === 'approve' && h.stage === 'supervisor')

export const reachedOfficer = (p: ReportPass): boolean =>
  p.status === 'officer_approved' ||
  p.status === 'checked_in' ||
  (p.history ?? []).some((h) => h.action === 'approve' && h.stage === 'officer')

export const wasCheckedIn = (p: ReportPass): boolean => p.status === 'checked_in' || p.checkIn !== undefined

/** `reject` and `revoke` decisions over every attempt. Passes without a history count what their rejections show. */
export function rejectionCount(p: ReportPass): number {
  if (p.history !== undefined) return p.history.filter((h) => h.action === 'reject' || h.action === 'revoke').length
  return (p.rejectionHistory?.length ?? 0) + (p.status === 'rejected' && p.rejection ? 1 : 0)
}

export interface RejectionEvent {
  passId: string
  at: number
  attempt: number
  contractorId: string
  plateNo: string
  stage: 'supervisor' | 'officer' | 'revoked'
  stageLabel: string
  byUid: string
  byName: string
  byRole: string
  reasonCode: string
  note: string
}

/**
 * Every rejection of a pass: `rejectionHistory[]` (earlier attempts) plus the current `rejection` while the pass is
 * rejected. History entries do not carry reasons, so nothing else is consulted.
 */
export function rejectionEvents(p: ReportPass): RejectionEvent[] {
  const out: RejectionEvent[] = []
  const push = (r: NonNullable<ReportPass['rejection']>, attempt: number): void => {
    out.push({
      passId: p.id,
      at: r.at,
      attempt,
      contractorId: p.contractorId,
      plateNo: p.plateNo,
      stage: r.stage,
      stageLabel: STAGE_LABELS[r.stage],
      byUid: r.byUid,
      byName: r.byName,
      byRole: r.byRole,
      reasonCode: r.reasonCode,
      note: r.note ?? '',
    })
  }
  for (const r of p.rejectionHistory ?? []) push(r, r.attempt)
  if (p.status === 'rejected' && p.rejection) push(p.rejection, p.attempt)
  return out
}
