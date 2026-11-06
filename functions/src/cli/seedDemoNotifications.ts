/**
 * Demo notifications and push devices for `npm run seed:demo` (EMULATOR ONLY, called by that script).
 *
 * Notifications are produced by the REAL planner (`planPassChange`, `planDenial`) and the real delivery code against the
 * seeded passes, as if each transition had just happened, so the demo shows exactly what production would show: the
 * supervisor's "Approval needed", the officers' "Awaiting officer approval", the driver's approved or rejected, the denial
 * to officers, admins and supervisors. Older ones are marked read. Fake push tokens are registered for the people who
 * would get pushes (no FCM here, so nothing is sent). Security guards receive no alerts by design.
 *
 * SLA reminders are left for `npm run sla:check`, so the reminder path can be shown on demand.
 */
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { dateKey } from '../dates.js'
import { actorOf, deliver, planDenial, planPassChange, type NotifyDeps } from '../notifications.js'
import { notifyPort } from '../notifyPorts.js'
import { toPass } from '../ports.js'
import type { GateEventData, PassData } from '../types.js'

const TENANT = process.argv[2] ?? 'demo'
const loopback = (v: string | undefined): boolean => Boolean(v && /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(v))
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (!loopback(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('seed:demo notifications: refusing to run against a non-local Firestore')
  process.exit(1)
}
const rc = ((): { projects?: { default?: string } } => {
  try {
    return JSON.parse(readFileSync('.firebaserc', 'utf8')) as { projects?: { default?: string } }
  } catch {
    return {}
  }
})()
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? rc.projects?.default ?? 'demo-conveypass' })
const db = getFirestore()

let clock = Date.now()
const deps: NotifyDeps = {
  data: notifyPort(),
  baseUrl: '',
  now: () => clock,
  messaging: { sendEach: async (m) => m.tokens.map(() => ({ success: true })) },
}

/** The state a pass was in just before its current one. */
function previousOf(p: PassData): PassData | null {
  switch (p.status) {
    case 'submitted':
      return null
    case 'supervisor_approved':
      return { ...p, status: 'submitted' }
    case 'officer_approved':
      return { ...p, status: 'supervisor_approved' }
    case 'checked_in':
      return { ...p, status: 'officer_approved' }
    case 'rejected':
      return { ...p, status: p.rejection?.stage === 'supervisor' ? 'submitted' : p.rejection?.stage === 'officer' ? 'supervisor_approved' : 'officer_approved' }
  }
}

async function main(): Promise<void> {
  const today = dateKey('Asia/Colombo')
  const passes = await db.collection('passes').where('tenantId', '==', TENANT).where('dateKey', '==', today).get()
  let made = 0
  for (const doc of passes.docs) {
    const pass = toPass(doc.data() as Record<string, unknown>)
    // The moment of the transition: the last decision (or the submission itself).
    clock = pass.history?.at(-1)?.at ?? pass.submittedAt ?? Date.now()
    const planned = planPassChange(doc.id, previousOf(pass), pass)
    made += (await deliver(deps, TENANT, planned, actorOf(pass), { fn: 'seedDemo', tenantId: TENANT })).created
  }
  const events = await db.collection('gateEvents').where('tenantId', '==', TENANT).where('dateKey', '==', today).get()
  for (const doc of events.docs) {
    const raw = doc.data() as Record<string, unknown>
    const event = { ...raw, at: (raw.at as Timestamp).toMillis() } as unknown as GateEventData
    clock = event.at
    made += (await deliver(deps, TENANT, planDenial(doc.id, event), event.byUid, { fn: 'seedDemo', tenantId: TENANT })).created
  }

  // Anything older than an hour has been looked at.
  const old = await db.collection('notifications').where('tenantId', '==', TENANT).get()
  const cutoff = Date.now() - 60 * 60_000
  const batch = db.batch()
  for (const d of old.docs) if ((d.data().createdAt as Timestamp).toMillis() < cutoff) batch.update(d.ref, { readAt: Timestamp.fromMillis(cutoff) })
  await batch.commit()

  // Fake push devices for supervisors, officers, admins and drivers (the people who get pushes).
  const users = await db.collection('users').where('tenantId', '==', TENANT).where('status', '==', 'active').get()
  let devices = 0
  for (const u of users.docs) {
    if (u.data().role === 'security') continue
    const token = `fake-fcm-token-${u.id}-`.padEnd(40, 'x')
    await db.doc(`users/${u.id}/devices/demo-device-${u.id}`.slice(0, 120)).set({
      token, platform: 'android', userAgent: 'Mozilla/5.0 (Linux; Android 14) seed:demo fake device', enabled: true,
      createdAt: FieldValue.serverTimestamp(), lastSeenAt: FieldValue.serverTimestamp(),
    })
    devices++
  }
  console.log(`seed:demo notifications: ${made} notifications from today's passes and denials, ${devices} fake push devices`)
}
main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error('seed:demo notifications failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  },
)
