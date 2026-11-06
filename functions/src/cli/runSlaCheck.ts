/**
 * Runs the SLA reminder check once, on demand (EMULATOR ONLY). The scheduled function `slaReminders` runs every 10
 * minutes in production; the emulators do not fire schedules, so this is how to see it work:
 *
 *   npm run emulators            # terminal 1
 *   npm run seed:demo            # terminal 2 (creates passes that are past their time target)
 *   npm run sla:check            # runs the real check; reminders appear in the bell of the supervisor, officers and admin
 *
 * Pushes are not sent (there is no FCM here): the script prints what would have gone to each device.
 * Run it twice: the second run finds nothing new (one reminder per step and attempt).
 */
import { initializeApp } from 'firebase-admin/app'
import { readFileSync } from 'node:fs'
import { notifyPort, slaPort } from '../notifyPorts.js'
import { runSlaCheck } from '../sla.js'

const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
const firebaseJson = readJson('firebase.json') as { emulators?: Record<string, { port?: number }> }
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
if (!/^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error(`sla:check: refusing to run: FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} is not a local emulator`)
  process.exit(1)
}
initializeApp({ projectId: (readJson('.firebaserc') as { projects?: { default?: string } }).projects?.default ?? 'demo-conveypass' })

async function main(): Promise<void> {
  const summary = await runSlaCheck(slaPort(), {
    data: notifyPort(),
    baseUrl: '',
    now: () => Date.now(),
    messaging: {
      sendEach: async (m) => {
        console.log(`  push (not sent, no FCM in the emulator): "${m.data.title}" | ${m.data.body} | tag ${m.data.tag} | ${m.tokens.length} device(s)`)
        return m.tokens.map(() => ({ success: true }))
      },
    },
  })
  console.log('\nsla:check:', JSON.stringify(summary))
  console.log(
    summary.alerted === 0
      ? 'sla:check: nothing new (everything past its target was already reminded, or nothing is late).'
      : 'sla:check: reminders created. Open the app: bell of the supervisor, officers and admin.',
  )
}
main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error('sla:check failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  },
)
