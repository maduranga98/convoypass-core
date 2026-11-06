import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { APP_BASE_URL, REGION } from './config.js'
import { recomputeEligibility } from './eligibility.js'
import { eligibilityPort } from './eligibilityPort.js'
import { logInfo } from './logger.js'
import { flagDwellVisits } from './dwell.js'
import { dwellPort } from './dwellPort.js'
import { expirePenalties } from './penaltyExpiry.js'
import { penaltyExpiryPort } from './penaltyExpiryPort.js'
import { actorOf, deliver, isStaleEvent, planDenial, planPassChange, type NotifyDeps } from './notifications.js'
import { messagingPort, notifyPort, slaPort } from './notifyPorts.js'
import { purgeOldEvidence } from './retention.js'
import { retentionPort } from './retentionPort.js'
import { runSlaCheck } from './sla.js'
import type { GateEventData, PassData } from './types.js'

/**
 * Firestore triggers may need to sit next to the database (asia-south2) rather than the callables (asia-south1):
 * set FIRESTORE_TRIGGER_REGION if the deploy rejects the default. See docs/ops.md.
 */
const TRIGGER_REGION = process.env.FIRESTORE_TRIGGER_REGION || REGION

export const notifyDeps = (): NotifyDeps => ({
  data: notifyPort(),
  messaging: messagingPort(),
  now: () => Date.now(),
  baseUrl: APP_BASE_URL,
})

// Triggers run at least once and `retry` re-runs a failed one: every notification id is deterministic and created
// with `create()`, so a repeat creates nothing and pushes nothing.
export const onPassWritten = onDocumentWritten({ document: 'passes/{passId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as PassData) : null
  const after = event.data?.after.exists ? (event.data.after.data() as PassData) : null
  if (!after) return
  const planned = planPassChange(event.params.passId, before, after)
  if (planned.length === 0) return
  await deliver(notifyDeps(), after.tenantId, planned, actorOf(after), { fn: 'onPassWritten', tenantId: after.tenantId })
})

export const onGateEventCreated = onDocumentCreated({ document: 'gateEvents/{eventId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const data = event.data?.data() as GateEventData | undefined
  if (!data || data.type !== 'denied') return
  const at = (data.at as unknown as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Date.now()
  if (isStaleEvent(at, Date.now())) {
    logInfo({ fn: 'onGateEventCreated', tenantId: data.tenantId }, 'skipped', { reason: 'stale' })
    return
  }
  await deliver(notifyDeps(), data.tenantId, planDenial(event.params.eventId, data), data.byUid, {
    fn: 'onGateEventCreated',
    tenantId: data.tenantId,
  })
})

export const slaReminders = onSchedule({ schedule: 'every 10 minutes', timeZone: 'UTC' }, async () => {
  const summary = await runSlaCheck(slaPort(), notifyDeps())
  logInfo({ fn: 'slaReminders' }, 'ok', { ...summary })
})

/** Daily, off-peak (02:30 Colombo). Does nothing unless a tenant set `retentionDays` (default: keep forever). */
export const purgeOldEvidenceDaily = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Colombo', memory: '512MiB', timeoutSeconds: 540 }, async () => {
  await purgeOldEvidence(retentionPort(), Date.now())
})

/** Daily, just after midnight Colombo: refreshes the denormalised `eligibilityStatus` of every vehicle and driver. */
export const recomputeEligibilityDaily = onSchedule({ schedule: '10 0 * * *', timeZone: 'Asia/Colombo', memory: '512MiB', timeoutSeconds: 540 }, async () => {
  await recomputeEligibility(eligibilityPort(), Date.now())
})

/**
 * Hourly: flips fixed penalties whose last day has passed from `active` to `expired`. Hourly rather than inside the daily
 * eligibility job because companies sit in different timezones; the live check never depends on it (`isBlocking`).
 */
export const expirePenaltiesHourly = onSchedule({ schedule: '5 * * * *', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
  await expirePenalties(penaltyExpiryPort(), Date.now())
})

/**
 * Every 15 minutes: flags visits that stayed checked in past the company's dwell limit (default 16 h). A warning only;
 * it never blocks a check-out or any other action.
 */
export const flagDwellVisitsScheduled = onSchedule({ schedule: '*/15 * * * *', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
  await flagDwellVisits(dwellPort(), Date.now())
})
