import { approvalPushText, templates, type NotificationType, type Text } from './notificationTemplates.js'
import { dateKey } from './dates.js'
import { DEFAULT_TIMEZONE } from './dates.js'
import { logError, logInfo, type LogContext } from './logger.js'
import type { GateEventData, PassData, Role, TenantData } from './types.js'

export const NOTIFICATION_TTL_DAYS = 30
export const MAX_DEVICES_PER_USER = 5
/** An event older than this is not announced (a seed, a backfill or a very late retry): nobody acts on a stale alert. */
export const MAX_EVENT_AGE_MS = 6 * 3_600_000
/** Approval pushes expire after an hour: a stale "approve this" is worse than none. */
export const APPROVAL_PUSH_TTL_SECONDS = 3600

// ---- Ports ---------------------------------------------------------------------------------

export interface NotificationDoc {
  tenantId: string
  recipientUid: string
  type: NotificationType
  title: string
  body: string
  /** An app path, never an absolute URL. */
  link: string
  passId?: string
  vehicleId?: string
  /** Milliseconds; the port stores Timestamps. `readAt` starts as null. */
  createdAt: number
  expireAt: number
}

export interface DeviceRef {
  deviceId: string
  token: string
}

export interface PushMessage {
  tokens: string[]
  data: Record<string, string>
  webpush: { headers: Record<string, string>; fcmOptions?: { link: string } }
}

export interface PushResult {
  success: boolean
  /** e.g. `messaging/registration-token-not-registered` */
  errorCode?: string
}

export interface NotifyPort {
  getTenant(tenantId: string): Promise<TenantData | null>
  /** Active users of the tenant with that role (and contractor, for supervisors). Never includes disabled users. */
  listActiveUids(q: { tenantId: string; role: Role; contractorId?: string }): Promise<string[]>
  isActiveUser(tenantId: string, uid: string): Promise<boolean>
  /** `create()`: false when the document already exists (a duplicate delivery). */
  createNotification(id: string, doc: NotificationDoc): Promise<boolean>
  /** Enabled devices only. */
  listDevices(uid: string): Promise<DeviceRef[]>
  deleteDevice(uid: string, deviceId: string): Promise<void>
  countPending(q: { tenantId: string; contractorId?: string; status: 'submitted' | 'supervisor_approved'; dateKey: string }): Promise<number>
}

export interface MessagingPort {
  /** One result per token, in order (`sendEachForMulticast`). May throw; callers swallow. */
  sendEach(message: PushMessage): Promise<PushResult[]>
}

export interface NotifyDeps {
  data: NotifyPort
  messaging: MessagingPort
  /** Milliseconds since epoch. */
  now: () => number
  /** https origin of the web app for absolute push links; empty = no link. */
  baseUrl: string
}

// ---- Plan (pure) ---------------------------------------------------------------------------

export type RecipientSpec =
  | { kind: 'supervisors'; contractorId: string }
  | { kind: 'officers' }
  | { kind: 'admins' }
  | { kind: 'user'; uid: string }

export interface PlannedNotification {
  /** First part of the document id. */
  event: string
  /** passId or gate event id. */
  sourceId: string
  attempt: number
  type: NotificationType
  to: RecipientSpec[]
  text: Text
  /** App path by recipient role. */
  link: (role: Role) => string
  passId?: string
  vehicleId?: string
  /** Set for "approval needed" style notifications: their push is collapsed per recipient. */
  approval?: { role: 'supervisor' | 'officer'; contractorId: string | null; plateNo: string; resubmitted: boolean }
}

/** `${event}_${passId|eventId}_${attempt}_${recipientUid}`: deterministic, so a duplicate delivery hits `create()` and stops. */
export const notificationId = (n: Pick<PlannedNotification, 'event' | 'sourceId' | 'attempt'>, uid: string): string =>
  `${n.event}_${n.sourceId}_${n.attempt}_${uid}`

export const passLink = (role: Role, passId: string): string => {
  switch (role) {
    case 'supervisor':
      return `/supervisor/approvals/${passId}`
    case 'officer':
      return `/officer?pass=${passId}`
    case 'admin':
      return `/admin/passes?pass=${passId}`
    default:
      return '/driver'
  }
}

/** Who made the change, from the last `history` entry. */
export const actorOf = (after: PassData): string | null => after.history?.at(-1)?.byUid ?? null

/**
 * What a write to `passes/{passId}` means for people. Compares status and attempt only: any other change
 * (an SLA stamp, an evidence purge) produces nothing.
 */
export function planPassChange(passId: string, before: PassData | null, after: PassData | null): PlannedNotification[] {
  if (!after) return []
  const base = { sourceId: passId, attempt: after.attempt, passId, vehicleId: after.vehicleId }
  const plate = after.plateNo
  const supervisors: RecipientSpec = { kind: 'supervisors', contractorId: after.contractorId }
  const toDriver: RecipientSpec = { kind: 'user', uid: after.driverId }
  const link = (role: Role) => passLink(role, passId)

  const created = !before
  const resubmitted = before?.status === 'rejected' && after.status === 'submitted'
  if ((created && after.status === 'submitted') || resubmitted) {
    return [
      {
        ...base,
        event: resubmitted ? 'resubmitted' : 'submitted',
        type: resubmitted ? 'resubmitted' : 'approval_needed',
        to: [supervisors],
        text: resubmitted ? templates.resubmitted({ plateNo: plate, attempt: after.attempt }) : templates.approvalNeeded({ plateNo: plate }),
        link,
        approval: { role: 'supervisor', contractorId: after.contractorId, plateNo: plate, resubmitted },
      },
    ]
  }
  if (!before || before.status === after.status) return []

  if (before.status === 'submitted' && after.status === 'supervisor_approved') {
    return [
      {
        ...base,
        event: 'supervisorApproved',
        type: 'awaiting_officer',
        to: [{ kind: 'officers' }],
        text: templates.awaitingOfficer({ plateNo: plate }),
        link,
        approval: { role: 'officer', contractorId: null, plateNo: plate, resubmitted: false },
      },
    ]
  }
  if (before.status === 'supervisor_approved' && after.status === 'officer_approved') {
    return [
      { ...base, event: 'officerApproved', type: 'pass_approved', to: [toDriver], text: templates.passApproved({ plateNo: plate }), link },
    ]
  }
  if (after.status === 'rejected') {
    const rejection = after.rejection
    const reason = rejection?.reason ?? 'See the pass for details'
    const out: PlannedNotification[] = [
      { ...base, event: 'rejected', type: 'pass_rejected', to: [toDriver], text: templates.passRejected({ plateNo: plate, reason }), link },
    ]
    if (rejection && (rejection.stage === 'officer' || rejection.stage === 'revoked')) {
      out.push({
        ...base,
        event: 'rejectedInfo',
        type: 'pass_rejected_info',
        to: [supervisors],
        text: templates.passRejectedInfo({ plateNo: plate, reason, stage: rejection.stage }),
        link,
      })
    }
    return out
  }
  if (before.status === 'officer_approved' && after.status === 'checked_in') {
    return [
      {
        ...base,
        event: 'checkedIn',
        type: 'checked_in',
        to: [toDriver],
        text: templates.checkedIn({ plateNo: plate, gateName: after.checkIn?.gateName ?? 'the gate' }),
        link,
      },
    ]
  }
  return []
}

/** A denial: officers, admins and the vehicle's contractor's supervisors. */
export function planDenial(eventId: string, event: GateEventData): PlannedNotification[] {
  return [
    {
      event: 'denied',
      sourceId: eventId,
      attempt: 0,
      type: 'entry_denied',
      to: [{ kind: 'officers' }, { kind: 'admins' }, { kind: 'supervisors', contractorId: event.contractorId }],
      text: templates.entryDenied({ plateNo: event.plateNo, reasonCode: event.reasonCode }),
      link: (role) => (role === 'supervisor' ? '/supervisor' : role === 'admin' ? '/admin/reports?type=gate_log' : '/officer'),
      vehicleId: event.vehicleId,
      ...(event.passId ? { passId: event.passId } : {}),
    },
  ]
}

/** True when an event happened too long ago to be worth a notification. */
export const isStaleEvent = (atMs: number, nowMs: number): boolean => nowMs - atMs > MAX_EVENT_AGE_MS

// ---- Delivery ------------------------------------------------------------------------------

/** Recipients of one spec, active and in the tenant, with their role (the role picks the link). */
async function resolve(deps: NotifyDeps, tenantId: string, spec: RecipientSpec): Promise<{ uid: string; role: Role }[]> {
  switch (spec.kind) {
    case 'user':
      return (await deps.data.isActiveUser(tenantId, spec.uid)) ? [{ uid: spec.uid, role: 'driver' }] : []
    case 'officers':
      return (await deps.data.listActiveUids({ tenantId, role: 'officer' })).map((uid) => ({ uid, role: 'officer' as const }))
    case 'admins':
      return (await deps.data.listActiveUids({ tenantId, role: 'admin' })).map((uid) => ({ uid, role: 'admin' as const }))
    case 'supervisors':
      return (await deps.data.listActiveUids({ tenantId, role: 'supervisor', contractorId: spec.contractorId })).map((uid) => ({
        uid,
        role: 'supervisor' as const,
      }))
  }
}

/** Unique active recipients, minus the person who caused the event. */
export async function recipientsFor(
  deps: NotifyDeps,
  tenantId: string,
  specs: RecipientSpec[],
  actorUid: string | null,
): Promise<{ uid: string; role: Role }[]> {
  const seen = new Map<string, Role>()
  for (const spec of specs) {
    for (const r of await resolve(deps, tenantId, spec)) if (!seen.has(r.uid)) seen.set(r.uid, r.role)
  }
  if (actorUid) seen.delete(actorUid)
  return [...seen].map(([uid, role]) => ({ uid, role }))
}

export interface DeliverySummary {
  created: number
  duplicates: number
  pushed: number
}

/**
 * Creates the in-app notification for every recipient (deterministic id + `create()`) and, only for the ones
 * actually created, sends a push. In-app errors are thrown after every recipient was tried (the trigger retries and
 * the ids make that safe); push errors never are.
 */
export async function deliver(
  deps: NotifyDeps,
  tenantId: string,
  planned: PlannedNotification[],
  actorUid: string | null,
  ctx: LogContext,
): Promise<DeliverySummary> {
  const summary: DeliverySummary = { created: 0, duplicates: 0, pushed: 0 }
  let firstError: unknown
  for (const n of planned) {
    const recipients = await recipientsFor(deps, tenantId, n.to, actorUid)
    const now = deps.now()
    for (const r of recipients) {
      const doc: NotificationDoc = {
        tenantId,
        recipientUid: r.uid,
        type: n.type,
        title: n.text.title,
        body: n.text.body,
        link: n.link(r.role),
        ...(n.passId ? { passId: n.passId } : {}),
        ...(n.vehicleId ? { vehicleId: n.vehicleId } : {}),
        createdAt: now,
        expireAt: now + NOTIFICATION_TTL_DAYS * 86_400_000,
      }
      try {
        if (!(await deps.data.createNotification(notificationId(n, r.uid), doc))) {
          summary.duplicates++
          continue
        }
        summary.created++
      } catch (e) {
        firstError ??= e
        continue
      }
      if (await pushTo(deps, tenantId, r.uid, doc, n, ctx)) summary.pushed++
    }
  }
  logInfo(ctx, 'ok', { ...summary, planned: planned.length })
  if (firstError) throw firstError
  return summary
}

/** Pending approvals today for one recipient, for the collapsed push. */
async function pendingCount(deps: NotifyDeps, tenantId: string, a: NonNullable<PlannedNotification['approval']>): Promise<number> {
  const tenant = await deps.data.getTenant(tenantId)
  return deps.data.countPending({
    tenantId,
    ...(a.role === 'supervisor' && a.contractorId ? { contractorId: a.contractorId } : {}),
    status: a.role === 'supervisor' ? 'submitted' : 'supervisor_approved',
    dateKey: dateKey(tenant?.timezone ?? DEFAULT_TIMEZONE, new Date(deps.now())),
  })
}

/** Builds and sends the push for one created notification. Returns true when a message went out. Never throws. */
export async function pushTo(
  deps: NotifyDeps,
  tenantId: string,
  uid: string,
  doc: NotificationDoc,
  n: PlannedNotification,
  ctx: LogContext,
): Promise<boolean> {
  try {
    const devices = await deps.data.listDevices(uid)
    if (devices.length === 0) return false

    let title = doc.title
    let body = doc.body
    let tag = `${n.type}-${n.sourceId}`
    let ttl: string | undefined
    if (n.approval) {
      // Collapse: one notification per recipient that updates with the current count.
      const count = await pendingCount(deps, tenantId, n.approval)
      if (count === 0) return false
      ;({ title, body } = approvalPushText({ plateNo: n.approval.plateNo, count, resubmitted: n.approval.resubmitted, role: n.approval.role }))
      tag = `pending-${n.approval.role}-${n.approval.contractorId ?? 'tenant'}`
      ttl = String(APPROVAL_PUSH_TTL_SECONDS)
    }
    return await sendToDevices(deps, uid, devices, { title, body, link: doc.link, tag, type: n.type, ...(ttl ? { ttl } : {}) }, ctx)
  } catch (e) {
    logError({ ...ctx, uid }, e, { step: 'push' })
    return false
  }
}

export interface PushContent {
  title: string
  body: string
  link: string
  tag: string
  type: string
  /** Seconds, as a string (webpush TTL header). */
  ttl?: string
}

/** Data-only: the service worker draws the notification. Dead tokens are deleted; one bad device never stops the rest. */
export async function sendToDevices(
  deps: NotifyDeps,
  uid: string,
  devices: DeviceRef[],
  content: PushContent,
  ctx: LogContext,
): Promise<boolean> {
  const absolute = deps.baseUrl.startsWith('https://') ? `${deps.baseUrl}${content.link}` : null
  let results: PushResult[]
  try {
    results = await deps.messaging.sendEach({
      tokens: devices.map((d) => d.token),
      data: { title: content.title, body: content.body, link: content.link, tag: content.tag, type: content.type, renotify: '1' },
      webpush: { headers: { ...(content.ttl ? { TTL: content.ttl } : {}), Urgency: 'high' }, ...(absolute ? { fcmOptions: { link: absolute } } : {}) },
    })
  } catch (e) {
    logError({ ...ctx, uid }, e, { step: 'send' })
    return false
  }
  let sent = 0
  let removed = 0
  for (const [i, r] of results.entries()) {
    const device = devices[i]
    if (!device) continue
    if (r.success) {
      sent++
    } else if (r.errorCode === 'messaging/registration-token-not-registered' || r.errorCode === 'messaging/invalid-registration-token') {
      try {
        await deps.data.deleteDevice(uid, device.deviceId)
        removed++
      } catch (e) {
        logError({ ...ctx, uid }, e, { step: 'delete-device' })
      }
    }
  }
  logInfo({ ...ctx, uid }, 'ok', { step: 'push', devices: devices.length, sent, removed })
  return sent > 0
}
