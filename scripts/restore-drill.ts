/**
 * A rehearsal of backup and restore that needs no cloud project: seed sample data in the Firestore emulator,
 * export it, start a fresh (empty) emulator, import the export, and check the counts with verify-restore. It proves
 * the data model survives an export and an import and that verify-restore notices a loss. The real procedure (gcloud
 * backups and PITR) is in docs/ops.md.
 *
 *   npm run drill:restore
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const DIR = '.drill'
const PROJECT = 'demo-conveypass-drill'
const env: NodeJS.ProcessEnv = { ...process.env, FIREBASE_PROJECT_ID: PROJECT } // the scripts under emulators:exec use the drill's emulator project
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k]

const run = (label: string, args: string[]): void => {
  console.log(`\n== ${label}`)
  const r = spawnSync('npx', ['firebase', 'emulators:exec', '--only', 'firestore', '--project', PROJECT, ...args], { stdio: 'inherit', env })
  if (r.status !== 0) {
    console.error(`restore-drill: step failed: ${label}`)
    process.exit(1)
  }
}

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })
writeFileSync(`${DIR}/seed.mjs`, `
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
initializeApp({ projectId: '${PROJECT}' })
const db = getFirestore()
const w = db.bulkWriter()
for (let i = 0; i < 120; i++) {
  w.create(db.doc('passes/p' + i), { tenantId: 't1', status: 'checked_in', dateKey: '20260310', attempt: 1, history: [{ action: 'check_in', at: Timestamp.now() }] })
  w.create(db.doc('auditLog/a' + i), { tenantId: 't1', action: 'pass.checkIn', actorUid: 'u1', meta: { attempt: 1 }, createdAt: Timestamp.now() })
}
for (let i = 0; i < 12; i++) w.create(db.doc('users/u' + i), { tenantId: 't1', role: 'driver', status: 'active' })
w.create(db.doc('tenants/t1'), { name: 'Drill', timezone: 'Asia/Colombo' })
await w.close()
console.log('seeded')
`)

run('1. seed sample data, save the counts, export on exit', [
  `--export-on-exit=${DIR}/export`,
  `node ${DIR}/seed.mjs && npx tsx scripts/verify-restore.ts --env emulator --save ${DIR}/counts.json`,
])
run('2. fresh emulator: import the export and verify the counts match', [
  `--import=${DIR}/export`,
  `npx tsx scripts/verify-restore.ts --env emulator --expect ${DIR}/counts.json`,
])

// The check must also notice a loss: delete one pass in a fresh import and expect a failure.
writeFileSync(`${DIR}/lose.mjs`, `
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
initializeApp({ projectId: '${PROJECT}' })
await getFirestore().doc('passes/p7').delete()
`)
console.log('\n== 3. the same import with one pass missing must be reported as a MISMATCH')
const lost = spawnSync('npx', ['firebase', 'emulators:exec', '--only', 'firestore', '--project', PROJECT, `--import=${DIR}/export`, `node ${DIR}/lose.mjs && npx tsx scripts/verify-restore.ts --env emulator --expect ${DIR}/counts.json`], { stdio: 'inherit', env })
if (lost.status === 0) {
  console.error('restore-drill: verify-restore did not notice the missing pass')
  process.exit(1)
}
console.log('\nrestore-drill: OK (export/import preserved every document; a loss is detected)')
rmSync(DIR, { recursive: true, force: true })
