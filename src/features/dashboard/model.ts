// Pure computations behind the dashboard: today's passes in, tiles and lists out. No Firestore, no React.
import type { SlaSettings } from '@/lib/defaultSla'
import type { GateEventDoc, PassWithId } from '@/types/passes'
import { toMs } from '@/features/passes/passView'

export interface Kpis {
  submitted: number
  waitingSupervisor: number
  waitingOfficer: number
  approved: number
  checkedIn: number
  rejected: number
}

/** "Submitted today" is every pass of today; the rest are the current status. */
export function computeKpis(passes: readonly PassWithId[]): Kpis {
  const k: Kpis = { submitted: passes.length, waitingSupervisor: 0, waitingOfficer: 0, approved: 0, checkedIn: 0, rejected: 0 }
  for (const p of passes) {
    if (p.status === 'submitted') k.waitingSupervisor++
    else if (p.status === 'supervisor_approved') k.waitingOfficer++
    else if (p.status === 'officer_approved') k.approved++
    else if (p.status === 'checked_in') k.checkedIn++
    else if (p.status === 'rejected') k.rejected++
  }
  return k
}

export interface ContractorRow {
  contractorId: string
  name: string
  submitted: number
  /** Waiting for a supervisor or an officer. */
  waiting: number
  approved: number
  checkedIn: number
  rejected: number
}

/** One row per contractor with a pass today, most waiting first. */
export function contractorRows(passes: readonly PassWithId[], nameOf: (id: string) => string): ContractorRow[] {
  const rows = new Map<string, ContractorRow>()
  for (const p of passes) {
    const row = rows.get(p.contractorId) ?? { contractorId: p.contractorId, name: nameOf(p.contractorId), submitted: 0, waiting: 0, approved: 0, checkedIn: 0, rejected: 0 }
    row.submitted++
    if (p.status === 'submitted' || p.status === 'supervisor_approved') row.waiting++
    else if (p.status === 'officer_approved') row.approved++
    else if (p.status === 'checked_in') row.checkedIn++
    else row.rejected++
    rows.set(p.contractorId, row)
  }
  return [...rows.values()].sort((a, b) => b.waiting - a.waiting || b.submitted - a.submitted || a.name.localeCompare(b.name))
}

export interface AttentionItem {
  pass: PassWithId
  /** Whose queue it is stuck in. */
  holder: 'supervisor' | 'officer'
  /** Milliseconds the pass has waited at this step. */
  waitedMs: number
  /** Milliseconds beyond the SLA. */
  overMs: number
}

/**
 * Passes waiting longer than their SLA, oldest (longest waiting) first. The clock of a submitted pass starts at the
 * (re)submission, that of a supervisor-approved pass at the supervisor's approval. Approved and rejected passes
 * never appear, so a pass leaves the list the moment it is decided.
 */
export function attentionItems(passes: readonly PassWithId[], nowMs: number, sla: SlaSettings): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const pass of passes) {
    const holder = pass.status === 'submitted' ? 'supervisor' : pass.status === 'supervisor_approved' ? 'officer' : null
    if (!holder) continue
    const since = holder === 'supervisor' ? toMs(pass.submittedAt) : toMs(pass.supervisor?.at)
    if (since === null) continue
    const waitedMs = Math.max(0, nowMs - since)
    const limit = (holder === 'supervisor' ? sla.supervisorMinutes : sla.officerMinutes) * 60_000
    if (waitedMs > limit) out.push({ pass, holder, waitedMs, overMs: waitedMs - limit })
  }
  return out.sort((a, b) => b.waitedMs - a.waitedMs || a.pass.id.localeCompare(b.pass.id))
}

export interface GateActivity {
  id: string
  kind: 'checkIn' | 'denied'
  atMs: number
  plateNo: string
  contractorId: string
  gate: string
  /** Offline check-in: device time (ISO), unverified. */
  offlineAt: string | null
}

/** The latest check-ins and denials, newest first. */
export function recentGateActivity(passes: readonly PassWithId[], events: readonly (GateEventDoc & { id: string })[], count = 15): GateActivity[] {
  const items: GateActivity[] = []
  for (const p of passes) {
    if (!p.checkIn) continue
    items.push({ id: `c_${p.id}`, kind: 'checkIn', atMs: toMs(p.checkIn.at) ?? 0, plateNo: p.plateNo, contractorId: p.contractorId, gate: p.checkIn.gateName, offlineAt: p.checkIn.offlineCapturedAt ?? null })
  }
  for (const e of events) {
    items.push({ id: `d_${e.id}`, kind: 'denied', atMs: toMs(e.at) ?? 0, plateNo: e.plateNo, contractorId: e.contractorId, gate: e.gateName, offlineAt: null })
  }
  return items.sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id)).slice(0, count)
}
