// Super admins (Module 9 "operators", Module 10 wording, Module 11 bootstrap), script-only: there is no signup, callable or
// UI that can create or promote one.
//   npm run superadmin:create  -- --env staging --email olive@convoypass.com --name "Olive"
//   npm run superadmin:create  -- --env staging --email olive@convoypass.com --repair | --reset-password
//   npm run superadmin:disable -- --env prod --confirm-prod --email olive@convoypass.com
// Logic only; `create-operator.ts` / `disable-operator.ts` wire the Admin SDK to it and `lib/env.ts` does the banner,
// the production confirmation and the credential check.
// An operator has custom claims { role: 'platform', platformAdmin: true } and NO tenantId, an `operators/{uid}` doc and no
// `users` doc, so every tenant rule denies them. The password is generated and printed ONCE (io.secret), or piped in with
// --password-stdin. It is never an argument, never in a log line, an audit entry or a document.
import { parseArgs } from 'node:util'
import { platformAudit } from '../functions/src/platform/platformAudit.ts'
import { randomTempPassword } from './adminResetCli.ts'
import { COMMON_OPTIONS, resolveTarget, type EnvName, type Firebaserc } from './lib/env.ts'
import { assertPassword, readPasswordFromStdin, SecretError, WHY_NO_PASSWORD_FLAG } from './lib/secrets.ts'
import {
  allOk, formatChecks, inspectOperator, OPERATOR_CLAIMS, repairOperator, type OperatorStore,
} from './superadminChecks.ts'

export { OPERATOR_CLAIMS }
export const OPERATOR_PASSWORD_MIN_LENGTH = 14
export const GENERATED_PASSWORD_LENGTH = 20

export interface OperatorIo extends OperatorStore {
  auth: OperatorStore['auth'] & {
    createUser(p: { email: string; password: string; displayName: string; emailVerified: true }): Promise<{ uid: string }>
    deleteUser(uid: string): Promise<void>
    disableUser(uid: string): Promise<void>
  }
  db: OperatorStore['db'] & {
    /** Any `users` doc with this email (a tenant account), even when its Auth user is gone. */
    tenantUserExistsWithEmail(email: string): Promise<boolean>
    disableOperator(uid: string, audit: ReturnType<typeof platformAudit>): Promise<void>
  }
  /** Ordinary output. Never carries a password. */
  out: (line: string) => void
  /** The ONE place a generated password is printed (the terminal; tests capture it apart from `out`). */
  secret: (line: string) => void
  firebaserc: Firebaserc
  randomPassword: () => string
  /** Whole stdin, for --password-stdin. */
  readPassword: () => Promise<string>
  /** `APP_BASE_URL`, for the sign-in URL in the next steps. */
  appBaseUrl?: string | undefined
}

class UsageError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OPTIONS = {
  ...COMMON_OPTIONS,
  email: { type: 'string' },
  name: { type: 'string' },
  password: { type: 'string' },
  'password-stdin': { type: 'boolean', default: false },
  repair: { type: 'boolean', default: false },
  'reset-password': { type: 'boolean', default: false },
  enable: { type: 'boolean', default: false },
} as const

const targetOf = (v: { env?: string | undefined; 'confirm-prod'?: boolean | undefined; 'confirm-production'?: boolean | undefined }, io: Pick<OperatorIo, 'firebaserc'>) =>
  resolveTarget({ env: v.env, confirmProduction: Boolean(v['confirm-prod'] || v['confirm-production']), firebaserc: io.firebaserc })

export const assertOperatorPassword = (password: string, email: string): void => assertPassword(password, email, OPERATOR_PASSWORD_MIN_LENGTH)

/** `<app>/platform/login`: the page a super admin signs in at. */
export function signInUrl(env: EnvName, appBaseUrl: string | undefined): string {
  const base = appBaseUrl?.trim().replace(/\/+$/, '') || (env === 'emulator' ? 'http://localhost:5173' : '<your APP_BASE_URL>')
  return `${base}/platform/login`
}

const report = async (io: OperatorIo, email: string, env: EnvName): Promise<boolean> => {
  const { checks } = await inspectOperator(io, email, env)
  io.out('')
  io.out('Read back from Firebase:')
  for (const l of formatChecks(checks)) io.out(l)
  io.out('')
  io.out(allOk(checks) ? 'RESULT: PASS. The super admin account is set up correctly.' : 'RESULT: FAIL. See the lines above; `npm run superadmin:doctor` explains each one.')
  return allOk(checks)
}

const nextSteps = (io: OperatorIo, env: EnvName, email: string, mustChange: boolean) => {
  io.out('')
  io.out('Next steps')
  io.out(`  1. Sign in at ${signInUrl(env, io.appBaseUrl)} as ${email}.`)
  if (mustChange) io.out('  2. You are asked to choose a new password (14+ characters) before anything else.')
  io.out(`  ${mustChange ? 3 : 2}. Check the setup any time:  npm run superadmin:doctor -- --env ${env} --email ${email}`)
  io.out('  Reminder: the app does NOT enforce MFA. Enable TOTP multi-factor authentication for this account before the first paying client (docs/superadmin.md).')
}

export async function runCreateOperator(argv: string[], io: OperatorIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    if (values.password !== undefined) throw new UsageError(WHY_NO_PASSWORD_FLAG)
    // Production is refused here too, before anything is read or written.
    const target = targetOf(values, io)
    const env = target.env
    const email = (values.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) throw new UsageError('--email is required and must be a valid address (use a company mailbox)')
    const name = (values.name ?? '').trim()
    if (values.repair && values['reset-password']) throw new UsageError('choose one of --repair or --reset-password')
    if ((values.repair || values['reset-password']) && values['password-stdin']) {
      throw new UsageError(values.repair ? '--repair never touches the password' : '--reset-password always generates a new temporary password: drop --password-stdin')
    }
    if (values.enable && !values.repair) throw new UsageError('--enable only goes with --repair')

    const user = await io.auth.getUserByEmail(email)
    // A super admin never shares a mailbox with a workspace user.
    // (A tenantId claim alone is not proof: an existing super admin with a stray claim is exactly what --repair is for.)
    const tenantUser = user
      ? (await io.db.userDocExists(user.uid)) ||
        (await io.db.tenantUserExistsWithEmail(email)) ||
        (typeof user.claims.tenantId === 'string' && (await io.db.getOperator(user.uid)) === null)
      : await io.db.tenantUserExistsWithEmail(email)
    if (tenantUser) throw new UsageError('that email belongs to a tenant user (a workspace account): a super admin needs their own mailbox')

    if (user) {
      if (!values.repair && !values['reset-password']) {
        throw new UsageError('Account exists. Use --repair to fix its setup or --reset-password to issue a new temporary password')
      }
      const existing = await io.db.getOperator(user.uid)
      if (values.repair) {
        const changed = await repairOperator(io, user, existing, { email, name: name || user.displayName || email.split('@')[0] || 'Super admin', env, enable: values.enable })
        io.out(`superadmin:create --repair (${env}): ${changed.length ? `re-applied ${changed.join(', ')}` : 'nothing needed changing'}. The password was not touched.`)
        if (user.disabled && !values.enable) io.out('Note: the account is disabled and stays disabled. Add --enable to re-enable it deliberately.')
        const ok = await report(io, email, env)
        return ok ? 0 : 1
      }
      // --reset-password
      if (!existing) throw new UsageError('this account has no operators profile: run --repair first')
      const password = io.randomPassword()
      await io.auth.updateUser(user.uid, { password })
      await io.auth.revokeRefreshTokens(user.uid)
      await io.db.saveOperator(user.uid, { email, mustChangePassword: true }, platformAudit('script', 'operator.passwordReset', user.uid, { env }))
      io.out(`superadmin:create --reset-password (${env}): new temporary password set for ${email}; every session was signed out.`)
      io.out('')
      io.secret(`  temporary password: ${password}`)
      io.out('')
      io.out('Shown ONCE. Store it in a password manager now. The next sign-in forces a new password.')
      const ok = await report(io, email, env)
      nextSteps(io, env, email, true)
      return ok ? 0 : 1
    }

    if (values.repair || values['reset-password']) throw new UsageError(`no account with ${email} in ${env}: run without --repair / --reset-password to create it`)
    if (name.length < 1 || name.length > 100) throw new UsageError('--name is required (1-100 characters)')
    const generated = !values['password-stdin']
    const password = generated ? io.randomPassword() : await io.readPassword()
    if (!generated) assertOperatorPassword(password, email)

    const { uid } = await io.auth.createUser({ email, password, displayName: name, emailVerified: true })
    try {
      await io.auth.setCustomUserClaims(uid, OPERATOR_CLAIMS)
      await io.db.saveOperator(uid, { name, email, status: 'active', mustChangePassword: generated }, platformAudit('script', 'operator.created', uid, { env }))
    } catch (e) {
      await io.auth.deleteUser(uid).catch(() => undefined) // no half-made operator
      throw e
    }
    io.out(`superadmin:create (${env}): created super admin ${email}`)
    if (generated) {
      io.out('')
      io.secret(`  temporary password: ${password}`)
      io.out('')
      io.out('Shown ONCE. Store it in a password manager now; it cannot be shown again (use --reset-password if it is lost).')
    }
    const ok = await report(io, email, env)
    nextSteps(io, env, email, generated)
    return ok ? 0 : 1
  } catch (e) {
    io.out(`superadmin:create: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

export async function runDisableOperator(argv: string[], io: OperatorIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    const target = targetOf(values, io)
    const email = (values.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) throw new UsageError('--email is required')
    const user = await io.auth.getUserByEmail(email)
    // Only operators: this script must never be a way to lock a tenant user out.
    const operator = user ? await io.db.getOperator(user.uid) : null
    if (!user || !operator) throw new UsageError(`no super admin with ${email}`)
    await io.auth.updateUser(user.uid, { disabled: true })
    await io.auth.revokeRefreshTokens(user.uid)
    await io.db.disableOperator(user.uid, platformAudit('script', 'operator.disabled', user.uid, { env: target.env }))
    io.out(`superadmin:disable (${target.env}): ${email} is disabled and signed out everywhere.`)
    io.out('Review what they did:  platformAuditLog in the Firebase console (actorUid = their uid), and the tenant auditLog entries with actorRole "superadmin".')
    return 0
  } catch (e) {
    io.out(`superadmin:disable: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

// ---- dev:superadmin (emulator only) --------------------------------------------------------------

export const DEV_SUPERADMIN = {
  email: 'superadmin@dev.convoypass.test',
  name: 'Dev Super Admin',
  /** DEV ONLY: fixed so the emulator can be reset and re-seeded without hunting for a password. Never used outside the emulator. */
  password: 'DevOnly-Superadmin-2026',
} as const

/**
 * Creates the fixed dev super admin in the emulator, or repairs it (claims, verified email, operators doc) and puts the fixed
 * password back. Refuses everything but `--env emulator`, even if called directly.
 */
export async function runDevSuperadmin(argv: string[], io: OperatorIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    const target = targetOf(values, io)
    if (target.env !== 'emulator') throw new UsageError('dev:superadmin runs only against the emulator (--env emulator)')
    const { email, name, password } = DEV_SUPERADMIN
    assertOperatorPassword(password, email)
    const user = await io.auth.getUserByEmail(email)
    if (!user) {
      if (await io.db.tenantUserExistsWithEmail(email)) throw new UsageError(`${email} belongs to a tenant user in this emulator`)
      const { uid } = await io.auth.createUser({ email, password, displayName: name, emailVerified: true })
      await io.auth.setCustomUserClaims(uid, OPERATOR_CLAIMS)
      await io.db.saveOperator(uid, { name, email, status: 'active', mustChangePassword: false }, platformAudit('script', 'operator.created', uid, { env: 'emulator', dev: true }))
      io.out('dev:superadmin: created the dev super admin.')
    } else {
      if ((await io.db.userDocExists(user.uid)) || typeof user.claims.tenantId === 'string') throw new UsageError(`${email} is a tenant user in this emulator: clear the emulator data`)
      const existing = await io.db.getOperator(user.uid)
      const changed = await repairOperator(io, user, existing, { email, name, env: 'emulator', enable: true })
      await io.auth.updateUser(user.uid, { password })
      await io.db.saveOperator(user.uid, { email, status: 'active', mustChangePassword: false }, platformAudit('script', 'operator.repaired', user.uid, { env: 'emulator', dev: true, changed: 'password' }))
      io.out(`dev:superadmin: ${changed.length ? `repaired ${changed.join(', ')}; ` : ''}the dev password was put back.`)
    }
    io.out('')
    io.out('  *** DEV ONLY: these credentials exist in the emulator and nowhere else. Never use them on a real project. ***')
    io.out(`  email:    ${email}`)
    io.out(`  password: ${password}`)
    io.out(`  sign in:  ${signInUrl('emulator', undefined)}`)
    return (await report(io, email, 'emulator')) ? 0 : 1
  } catch (e) {
    io.out(`dev:superadmin: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

export { randomTempPassword, readPasswordFromStdin, SecretError }
