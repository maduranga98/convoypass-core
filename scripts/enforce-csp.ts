/**
 * Writes `firebase.enforce-csp.json`: firebase.json with the Content-Security-Policy-Report-Only header turned into an
 * enforcing Content-Security-Policy. firebase.json is the one place the policy is edited; run `npm run config:csp`
 * after changing it (a unit test fails when the two files drift).
 *
 *   firebase deploy --only hosting --config firebase.enforce-csp.json     # ONLY after the report-only run is clean
 */
import { readFileSync, writeFileSync } from 'node:fs'

export const REPORT_ONLY = 'Content-Security-Policy-Report-Only'
export const ENFORCING = 'Content-Security-Policy'

interface Header { key: string; value: string }
interface Config { hosting: { headers: { source: string; headers: Header[] }[] } }

export function enforcingConfig(source: string): string {
  const config = JSON.parse(source) as Config
  let swapped = 0
  for (const rule of config.hosting.headers) {
    for (const h of rule.headers) {
      if (h.key === REPORT_ONLY) {
        h.key = ENFORCING
        swapped++
      }
    }
  }
  if (swapped !== 1) throw new Error(`expected exactly one ${REPORT_ONLY} header in firebase.json, found ${swapped}`)
  return `${JSON.stringify(config, null, 2)}\n`
}

if (process.argv[1]?.endsWith('enforce-csp.ts')) {
  writeFileSync('firebase.enforce-csp.json', enforcingConfig(readFileSync('firebase.json', 'utf8')))
  console.log('wrote firebase.enforce-csp.json (enforcing CSP). Deploy it only after the report-only run is clean.')
}
