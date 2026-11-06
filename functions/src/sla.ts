import { dateKey, DEFAULT_TIMEZONE } from './dates.js'
import { slaOf } from './defaultSla.js'
import { logError, logInfo } from './logger.js'
import { templates } from './notificationTemplates.js'
import {
  notificationId,
  NOTIFICATION_TTL_DAYS,
  passLink,
  pushTo,
  recipientsFor,
  type NotificationDoc,
  type NotifyDeps,
  type PlannedNotification,
} from './notifications.js'
import type { PassData, SlaStage, TenantData } from './types.js'

/** Per tenant and run. The oldest waiting passes go first; the rest follow on the next 10-minute run. */
export const SLA_MAX_PASSES_PER_RUN = 200

export interface SlaPort {
  listTenants(): Promise<{ id: string; data: TenantData }[]>
  /** Today's passes of the tenant in that status, oldest wait first (everything pending today; the cap is applied after the breach filter). */
  listSlaCandidates(q: { tenantId: string; dateKey: string; status: 'submitted' | 'supervisor_approved' }): Promise<{ id: string; pass: PassData }[]>
  /**
   * One transaction: re-read the pass; when it still has that status and attempt and no `slaAlerts.<stage>` for the
   * attempt, set `slaAlerts.<stage> = { attempt, at }` and create every notification doc. False = nothing written.
   */
  alertTx(p: { passId: string; stage: SlaStage; attempt: number; status: 'submitted' | 'supervisor_approved'; docs: { id: string; doc: NotificationDoc }[]; nowMs: number }): Promise<boolean>
}

export interface SlaSummary {
  tenants: number
  checked: number
  alerted: number
  notifications: number
  failed: number
}

const STAGES = [
  { stage: 'supervisor', status: 'submitted' },
  { stage: 'officer', status: 'supervisor_approved' },
] as const satisfies readonly { stage: SlaStage; status: 'submitted' | 'supervisor_approved' }[]

/** Minutes the pass has waited at its current step, or null when its clock is missing. */
const waitedSince = (pass: PassData, stage: SlaStage): number | null => (stage === 'supervisor' ? pass.submittedAt : (pass.supervisor?.at ?? null))

export const isBreached = (pass: PassData, stage: SlaStage, thresholdMinutes: number, nowMs: number): boolean => {
  const since = waitedSince(pass, stage)
  return since !== null && nowMs - since > thresholdMinutes * 60_000 && pass.slaAlerts?.[stage]?.attempt !== pass.attempt
}

/** Reminders for one pass: the responsible party (collapsed push) and the admins. */
export function planSla(passId: string, pass: PassData, stage: SlaStage, minutes: number): PlannedNotification[] {
  const text = templates.slaOverdue({ plateNo: pass.plateNo, waitingFor: stage, minutes })
  const base = {
    event: stage === 'supervisor' ? 'slaSupervisor' : 'slaOfficer',
    sourceId: passId,
    attempt: pass.attempt,
    type: 'sla_overdue' as const,
    text,
    link: (role: Parameters<typeof passLink>[0]) => passLink(role, passId),
    passId,
    vehicleId: pass.vehicleId,
  }
  return [
    {
      ...base,
      to: [stage === 'supervisor' ? { kind: 'supervisors', contractorId: pass.contractorId } : { kind: 'officers' }],
      approval: { role: stage === 'supervisor' ? 'supervisor' : 'officer', contractorId: stage === 'supervisor' ? pass.contractorId : null, plateNo: pass.plateNo, resubmitted: false },
    },
    { ...base, to: [{ kind: 'admins' }] },
  ]
}

/**
 * The scheduled check (every 10 minutes). Idempotent: the `slaAlerts` stamp and the notification documents are
 * written in one transaction, so a pass is reminded once per step and attempt, and a re-run finds nothing to do.
 * A resubmission (a higher attempt) can be reminded again.
 */
export async function runSlaCheck(sla: SlaPort, deps: NotifyDeps): Promise<SlaSummary> {
  const summary: SlaSummary = { tenants: 0, checked: 0, alerted: 0, notifications: 0, failed: 0 }
  const nowMs = deps.now()
  for (const tenant of await sla.listTenants()) {
    summary.tenants++
    const settings = slaOf(tenant.data)
    const today = dateKey(tenant.data.timezone ?? DEFAULT_TIMEZONE, new Date(nowMs))
    let budget = SLA_MAX_PASSES_PER_RUN
    for (const { stage, status } of STAGES) {
      if (budget <= 0) break
      const minutes = stage === 'supervisor' ? settings.supervisorMinutes : settings.officerMinutes
      const candidates = await sla.listSlaCandidates({ tenantId: tenant.id, dateKey: today, status })
      summary.checked += candidates.length
      // Passes already reminded for this attempt drop out first, so they never use up the cap.
      const due = candidates.filter(({ pass }) => pass.tenantId === tenant.id && pass.status === status && isBreached(pass, stage, minutes, nowMs))
      for (const { id, pass } of due) {
        if (budget <= 0) break
        budget--
        const ctx = { fn: 'slaReminders', tenantId: tenant.id }
        try {
          const planned = planSla(id, pass, stage, minutes)
          const docs: { id: string; doc: NotificationDoc }[] = []
          const owners = new Map<string, PlannedNotification>()
          for (const n of planned) {
            for (const r of await recipientsFor(deps, tenant.id, n.to, null)) {
              if (owners.has(r.uid)) continue
              owners.set(r.uid, n)
              docs.push({
                id: notificationId(n, r.uid),
                doc: {
                  tenantId: tenant.id, recipientUid: r.uid, type: n.type, title: n.text.title, body: n.text.body, link: n.link(r.role),
                  ...(n.passId ? { passId: n.passId } : {}), ...(n.vehicleId ? { vehicleId: n.vehicleId } : {}),
                  createdAt: nowMs, expireAt: nowMs + NOTIFICATION_TTL_DAYS * 86_400_000,
                },
              })
            }
          }
          if (docs.length === 0) continue // nobody to tell right now: stay unstamped so a later run can try again
          const done = await sla.alertTx({ passId: id, stage, attempt: pass.attempt, status, docs, nowMs })
          if (!done) continue
          summary.alerted++
          summary.notifications += docs.length
          for (const { doc } of docs) {
            const n = owners.get(doc.recipientUid)
            if (n) await pushTo(deps, tenant.id, doc.recipientUid, doc, n, ctx)
          }
        } catch (e) {
          summary.failed++
          logError({ fn: 'slaReminders', tenantId: tenant.id }, e, { step: 'alert' })
        }
      }
    }
  }
  logInfo({ fn: 'slaReminders' }, 'ok', { ...summary })
  return summary
}
