// `superadmin:doctor`: reads a super admin account back from Firebase and reports PASS/FAIL per check, with the likely
// cause and the fix command for each failure. `--fix` repairs what can be repaired (claims, verified email, operators
// profile) and never the password, never a disabled state, never a users doc. Idempotent. Logic only (wiring: superadmin-doctor.ts).
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, resolveTarget, type Firebaserc } from './lib/env.ts'
import {
  allOk, callableDeployed, DEFAULT_FUNCTIONS_REGION, formatChecks, inspectOperator, repairOperator, type Check, type FetchLike, type OperatorStore,
} from './superadminChecks.ts'

export interface DoctorIo extends OperatorStore {
  out: (line: string) => void
  firebaserc: Firebaserc
  fetch: FetchLike
  /** FUNCTIONS_REGION from `functions/.env.<alias>`. */
  region: string | undefined
}

const OPTIONS = { ...COMMON_OPTIONS, email: { type: 'string' }, fix: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function runDoctor(argv: string[], io: DoctorIo): Promise<number> {
  const json = argv.includes('--json')
  const fail = (msg: string): number => {
    if (json) io.out(JSON.stringify({ ok: false, error: msg }))
    else io.out(`superadmin:doctor: ${msg}`)
    return 1
  }
  try {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    const target = resolveTarget({ env: values.env, confirmProduction: Boolean(values['confirm-prod'] || values['confirm-production']), firebaserc: io.firebaserc })
    const email = (values.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) return fail('--email is required')

    const run = async (): Promise<{ user: Awaited<ReturnType<typeof inspectOperator>>['user']; checks: Check[] }> => {
      const { user, checks } = await inspectOperator(io, email, target.env)
      // HTTP reachability only, never against the emulator and never with credentials.
      if (target.env !== 'emulator') {
        checks.push(await callableDeployed(io.fetch, { region: io.region ?? DEFAULT_FUNCTIONS_REGION, projectId: target.projectId }))
      }
      return { user, checks }
    }

    let { user, checks } = await run()
    const fixed: string[] = []
    if (values.fix && user && checks.some((c) => !c.ok && c.fixable)) {
      const existing = await io.db.getOperator(user.uid)
      fixed.push(...(await repairOperator(io, user, existing, { email, name: user.displayName || email.split('@')[0] || 'Super admin', env: target.env, enable: false })))
      ;({ user, checks } = await run())
    }

    const ok = allOk(checks)
    if (json) {
      io.out(JSON.stringify({ ok, env: target.env, projectId: target.projectId, email, fixed, checks: checks.map(({ id, label, ok: passed, detail, cause, fix }) => ({ id, label, ok: passed, ...(detail ? { detail } : {}), ...(cause ? { cause } : {}), ...(fix ? { fix } : {}) })) }, null, 2))
    } else {
      io.out(`Super admin check for ${email}`)
      io.out('')
      if (fixed.length) io.out(`Fixed: ${fixed.join(', ')} (the password was not touched)`)
      for (const l of formatChecks(checks)) io.out(l)
      io.out('')
      io.out(ok ? 'RESULT: PASS' : `RESULT: FAIL (${checks.filter((c) => !c.ok).length} problem(s)).${values.fix ? '' : ' Add --fix to repair claims, verified email and the profile.'}`)
    }
    return ok ? 0 : 1
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}
