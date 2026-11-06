// All notification text lives here, in English only. Each template is a function of plain data so a later
// translation can swap this one file (or key the functions by locale) without touching the triggers.
import { DENY_REASONS } from './denyReasons.js'

export type NotificationType =
  | 'approval_needed'
  | 'resubmitted'
  | 'awaiting_officer'
  | 'pass_approved'
  | 'pass_rejected'
  | 'pass_rejected_info'
  | 'checked_in'
  | 'entry_denied'
  | 'sla_overdue'
  | 'security_new_device'

export interface Text {
  title: string
  body: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const templates = {
  approvalNeeded: (p: { plateNo: string }): Text => ({
    title: 'Approval needed',
    body: `${p.plateNo} is waiting for your approval`,
  }),
  resubmitted: (p: { plateNo: string; attempt: number }): Text => ({
    title: `Resubmitted, attempt ${p.attempt}`,
    body: `${p.plateNo} was corrected and sent again for your approval`,
  }),
  awaitingOfficer: (p: { plateNo: string }): Text => ({
    title: 'Awaiting officer approval',
    body: `${p.plateNo} was approved by the supervisor`,
  }),
  passApproved: (p: { plateNo: string }): Text => ({
    title: 'Approved. Show your vehicle at the gate',
    body: `${p.plateNo} is approved for today`,
  }),
  passRejected: (p: { plateNo: string; reason: string }): Text => ({
    title: 'Pass rejected',
    body: `${p.plateNo}: ${p.reason}`,
  }),
  passRejectedInfo: (p: { plateNo: string; reason: string; stage: 'officer' | 'revoked' }): Text => ({
    title: p.stage === 'revoked' ? 'Pass revoked' : 'Pass rejected by the officer',
    body: `${p.plateNo}: ${p.reason}`,
  }),
  checkedIn: (p: { plateNo: string; gateName: string }): Text => ({
    title: `Checked in at ${p.gateName}`,
    body: `${p.plateNo} entered the site`,
  }),
  entryDenied: (p: { plateNo: string; reasonCode: string }): Text => ({
    title: `Entry denied: ${p.plateNo}`,
    body: `Entry denied: ${p.plateNo}, ${denyReasonLabel(p.reasonCode)}`,
  }),
  securityNewDevice: (p: { name: string }): Text => ({
    title: 'Security sign-in on a new device',
    body: `${p.name} signed in on a new device`,
  }),
  slaOverdue: (p: { plateNo: string; waitingFor: 'supervisor' | 'officer'; minutes: number }): Text => ({
    title: 'Approval overdue',
    body: `${p.plateNo} has waited more than ${p.minutes} min for ${p.waitingFor === 'supervisor' ? 'a supervisor' : 'an officer'}`,
  }),
}

/** Push title and body for the collapsed "N passes awaiting your approval" notification. */
export const approvalPushText = (p: { plateNo: string; count: number; resubmitted?: boolean; role: 'supervisor' | 'officer' }): Text => ({
  title: `${p.resubmitted ? 'Resubmitted' : p.role === 'officer' ? 'Awaiting officer approval' : 'Approval needed'}: ${p.plateNo}`,
  body: `${plural(p.count, 'pass', 'passes')} awaiting your approval`,
})

export const denyReasonLabel = (code: string): string =>
  DENY_REASONS.find((r) => r.id === code)?.label ?? 'See the gate log'
