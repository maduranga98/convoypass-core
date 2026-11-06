/**
 * Counts documents per collection in a database and compares them (restore drill, docs/ops.md).
 *
 *   npm run verify-restore -- --env staging --database restore-drill            # compares with (default)
 *   npm run verify-restore -- --env staging --database restore-drill --tolerance 25
 *   npm run verify-restore -- --env emulator --expect .drill/counts.json        # against a saved snapshot
 *   npm run verify-restore -- --env emulator --save .drill/counts.json          # save the current counts
 *
 * Read only. Exits 1 when a collection differs by more than --tolerance (default 0).
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, connect, main } from './lib/env.ts'
import { COLLECTIONS, compareCounts, formatComparison, type Counts } from './restoreCheck.ts'

const HELP = `
Counts documents per collection in a database and compares them (restore drill, docs/ops.md). Read only.

  npm run verify-restore -- --env staging --database restore-drill [--against "(default)"] [--tolerance 25]
  npm run verify-restore -- --env emulator --expect .drill/counts.json
  npm run verify-restore -- --env emulator --save .drill/counts.json

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text
`

const OPTIONS = {
  ...COMMON_OPTIONS,
  database: { type: 'string' },
  against: { type: 'string', default: '(default)' },
  tolerance: { type: 'string', default: '0' },
  expect: { type: 'string' },
  save: { type: 'string' },
} as const

async function count(databaseId: string): Promise<Counts> {
  const db = databaseId === '(default)' ? getFirestore(getApp()) : getFirestore(getApp(), databaseId)
  const out: Counts = {}
  for (const c of COLLECTIONS) out[c] = (await db.collection(c).count().get()).data().count
  return out
}

async function verify(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: OPTIONS })
  const tolerance = Number(values.tolerance)
  if (!Number.isInteger(tolerance) || tolerance < 0) {
    console.error('verify-restore: --tolerance must be a whole number')
    return 1
  }
  const database = values.database ?? '(default)'
  const actual = await count(database)
  if (values.save) {
    mkdirSync(dirname(values.save), { recursive: true })
    writeFileSync(values.save, JSON.stringify(actual, null, 2))
    console.log(`verify-restore: saved counts of ${database} to ${values.save}`)
    return 0
  }
  const expected: Counts = values.expect ? (JSON.parse(readFileSync(values.expect, 'utf8')) as Counts) : await count(values.against ?? '(default)')
  const result = compareCounts(expected, actual, tolerance)
  console.log(`verify-restore: ${database} (restored) against ${values.expect ?? values.against} (expected)\n`)
  console.log(formatComparison(result))
  console.log(result.ok ? '\nverify-restore: OK' : '\nverify-restore: MISMATCH (see above)')
  return result.ok ? 0 : 1
}

main({
  name: 'verify-restore',
  help: HELP,
  action: () => 'read document counts per collection (read only) and compare them',
  run: (argv, target) => {
    connect(target)
    return verify(argv)
  },
})
