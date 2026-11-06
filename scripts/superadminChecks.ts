// What "a healthy super admin" means, in one place: `superadmin:create` reads it back after writing, `superadmin:doctor`
// reports it, `--repair` / `--fix` repair what can be repaired. Logic only; the Admin SDK wiring is in operatorIo.ts.
//   Auth user (enabled, verified email) + claims exactly { role: 'platform', platformAdmin: true }
//   + an active operators/{uid} doc + NO users/{uid} doc (an operator is never part of a tenant)
// Nothing here reads or prints a password.
import type { PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'

export const OPERATOR_CLAIMS = { role: 'platform', platformAdmin: true } as const

export interface AuthUserInfo {
  uid: string
  email: string
  displayName: string | null
  emailVerified: boolean
  disabled: boolean
  claims: Record<string, unknown>
}

export interface OperatorDoc {
  name: string
  email: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
}

/** What the checks and the repairs need from Firebase. Implemented with the Admin SDK in operatorIo.ts, faked in tests. */
export interface OperatorStore {
  auth: {
    getUserByEmail(email: string): Promise<AuthUserInfo | null>
    getUser(uid: string): Promise<AuthUserInfo | null>
    updateUser(uid: string, p: { emailVerified?: true; password?: string; disabled?: boolean; displayName?: string }): Promise<void>
    setCustomUserClaims(uid: string, claims: typeof OPERATOR_CLAIMS): Promise<void>
    revokeRefreshTokens(uid: string): Promise<void>
  }
  db: {
    getOperator(uid: string): Promise<OperatorDoc | null>
    /** Creates or completes `operators/{uid}` and writes the audit entry in one batch. `mustChangePassword` is left alone when undefined. */
    saveOperator(uid: string, doc: { name?: string; email: string; status?: 'active'; mustChangePassword?: boolean }, audit: PlatformAuditEntry): Promise<void>
    userDocExists(uid: string): Promise<boolean>
  }
}

export interface Check {
  id: 'auth-user' | 'not-disabled' | 'email-verified' | 'claims' | 'claims-extra' | 'operator-doc' | 'operator-active' | 'no-users-doc' | 'callable'
  label: string
  ok: boolean
  /** What was found, when it fails. */
  detail?: string
  /** Likely cause, when it fails. */
  cause?: string
  /** The fix, as a command or a manual step. */
  fix?: string
  /** `--fix` / `--repair` can fix this one. */
  fixable?: boolean
}

export interface Inspection {
  user: AuthUserInfo | null
  checks: Check[]
}

const OWN_CLAIMS = new Set(Object.keys(OPERATOR_CLAIMS))

/** The checks that need no network beyond Firebase. `email` is used in the fix commands only. */
export async function inspectOperator(store: OperatorStore, email: string, env: string): Promise<Inspection> {
  const cmd = (flags: string) => `npm run superadmin:create -- --env ${env} --email ${email} ${flags}`.trim()
  const user = await store.auth.getUserByEmail(email)
  if (!user) {
    return {
      user: null,
      checks: [{
        id: 'auth-user', label: 'Auth user exists', ok: false, detail: `no Auth account for ${email}`,
        cause: 'the account was never created in this project, was deleted, or the email is misspelt',
        fix: `${cmd('--name "<Full name>"')}   (check --env: staging and prod are different projects)`,
      }],
    }
  }
  const checks: Check[] = [{ id: 'auth-user', label: 'Auth user exists', ok: true }]
  const operator = await store.db.getOperator(user.uid)

  checks.push(user.disabled
    ? { id: 'not-disabled', label: 'Auth user is not disabled', ok: false, detail: 'the Auth user is disabled', cause: 'superadmin:disable was run, or it was disabled in the Firebase console', fix: `${cmd('--repair --enable')}   (only if re-enabling is intended)` }
    : { id: 'not-disabled', label: 'Auth user is not disabled', ok: true })

  checks.push(user.emailVerified
    ? { id: 'email-verified', label: 'Email is verified', ok: true }
    : { id: 'email-verified', label: 'Email is verified', ok: false, detail: 'emailVerified is false', cause: 'the account was edited in the console, or created some other way; the console refuses unverified super admins', fix: `${cmd('--repair')}   (or: superadmin:doctor --fix)`, fixable: true })

  const roleOk = user.claims.role === OPERATOR_CLAIMS.role && user.claims.platformAdmin === OPERATOR_CLAIMS.platformAdmin
  checks.push(roleOk
    ? { id: 'claims', label: "Claims are role 'platform' + platformAdmin", ok: true }
    : {
        id: 'claims', label: "Claims are role 'platform' + platformAdmin", ok: false,
        detail: `found role=${JSON.stringify(user.claims.role ?? null)} platformAdmin=${JSON.stringify(user.claims.platformAdmin ?? null)}`,
        cause: 'the claims were never set, were removed, or the account has another role', fix: `${cmd('--repair')}   (or: superadmin:doctor --fix)`, fixable: true,
      })

  const extra = Object.keys(user.claims).filter((k) => !OWN_CLAIMS.has(k))
  checks.push(extra.length === 0
    ? { id: 'claims-extra', label: 'No other claims (no tenantId)', ok: true }
    : {
        id: 'claims-extra', label: 'No other claims (no tenantId)', ok: false, detail: `extra claim(s): ${extra.join(', ')}`,
        cause: 'the account also belongs to a workspace (a token with a tenantId is not a super admin token)', fix: `${cmd('--repair')}   (re-applies exactly the two claims)`, fixable: true,
      })

  checks.push(operator
    ? { id: 'operator-doc', label: 'operators/{uid} exists', ok: true }
    : { id: 'operator-doc', label: 'operators/{uid} exists', ok: false, detail: 'no operators document', cause: 'it was deleted, or creation stopped half way', fix: `${cmd('--repair')}   (or: superadmin:doctor --fix)`, fixable: true })

  checks.push(operator?.status === 'active'
    ? { id: 'operator-active', label: 'operators/{uid} is active', ok: true }
    : {
        id: 'operator-active', label: 'operators/{uid} is active', ok: false, detail: operator ? `status is "${operator.status}"` : 'no operators document',
        cause: operator ? 'superadmin:disable was run' : 'see the previous row', fix: operator ? `${cmd('--repair --enable')}   (only if re-enabling is intended)` : `${cmd('--repair')}`, fixable: !operator,
      })

  checks.push(!(await store.db.userDocExists(user.uid))
    ? { id: 'no-users-doc', label: 'No users/{uid} document (not a tenant user)', ok: true }
    : {
        id: 'no-users-doc', label: 'No users/{uid} document (not a tenant user)', ok: false, detail: 'a workspace user profile exists for this account',
        cause: 'this email was (or is) a workspace user; a super admin needs their own mailbox', fix: 'cannot be fixed automatically (it is business data): use another email for the super admin, or remove the workspace user in the app first',
      })
  return { user, checks }
}

export const allOk = (checks: Check[]): boolean => checks.every((c) => c.ok)

export function formatChecks(checks: Check[]): string[] {
  const lines: string[] = []
  for (const c of checks) {
    lines.push(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok || !c.detail ? '' : `: ${c.detail}`}`)
    if (!c.ok) {
      if (c.cause) lines.push(`          likely cause: ${c.cause}`)
      if (c.fix) lines.push(`          fix: ${c.fix}`)
    }
  }
  return lines
}

export interface RepairOptions {
  email: string
  /** Used when `operators/{uid}` has to be created. */
  name: string
  env: string
  /** Re-enable an account disabled with superadmin:disable. Never done implicitly. */
  enable: boolean
}

/**
 * Re-applies what a super admin needs, WITHOUT touching the password: claims (exactly two), verified email, the operators
 * doc. A disabled account stays disabled unless `enable` is set. Returns what it changed (for the report).
 */
export async function repairOperator(store: OperatorStore, user: AuthUserInfo, existing: OperatorDoc | null, o: RepairOptions): Promise<string[]> {
  const changed: string[] = []
  const claimsOk = user.claims.role === OPERATOR_CLAIMS.role && user.claims.platformAdmin === OPERATOR_CLAIMS.platformAdmin && Object.keys(user.claims).every((k) => OWN_CLAIMS.has(k))
  if (!claimsOk) {
    await store.auth.setCustomUserClaims(user.uid, OPERATOR_CLAIMS)
    changed.push('claims')
  }
  const authFix: { emailVerified?: true; disabled?: boolean } = {}
  if (!user.emailVerified) authFix.emailVerified = true
  if (user.disabled && o.enable) authFix.disabled = false
  if (Object.keys(authFix).length > 0) {
    await store.auth.updateUser(user.uid, authFix)
    changed.push(...(authFix.emailVerified ? ['emailVerified'] : []), ...(authFix.disabled === false ? ['enabled'] : []))
  }
  const create = !existing
  if (create || existing.email !== o.email || (o.enable && existing.status !== 'active')) changed.push(create ? 'operatorDoc' : 'operatorDocFields')
  // One audit entry per repair, written together with the profile (never a secret in it).
  if (changed.length > 0) {
    await store.db.saveOperator(
      user.uid,
      {
        email: o.email,
        ...(create ? { name: o.name, mustChangePassword: false } : {}),
        ...(create || o.enable ? { status: 'active' as const } : {}),
      },
      { actorUid: 'script', action: 'operator.repaired', targetRef: user.uid, meta: { env: o.env, changed: changed.join(',') } },
    )
  }
  return changed
}

// ---- the deployed-callable check (doctor only, never against the emulator) -----------------------

export interface FunctionsTarget {
  region: string
  projectId: string
}

export interface FetchLike {
  (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<{ status: number }>
}

/** HTTP reachability only: a callable answers a call without a token with 401/403/400, a missing one with 404. No credentials are sent. */
export async function callableDeployed(fetchFn: FetchLike, t: FunctionsTarget): Promise<Check> {
  const url = `https://${t.region}-${t.projectId}.cloudfunctions.net/getOperatorProfile`
  const base = { id: 'callable' as const, label: `getOperatorProfile callable is deployed (${t.region})` }
  try {
    const { status } = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"data":{}}' })
    if (status === 401 || status === 403 || status === 400 || status === 200) return { ...base, ok: true }
    return {
      ...base, ok: false, detail: `HTTP ${status} from ${url}`,
      cause: status === 404 ? 'the functions are not deployed to this project/region (or FUNCTIONS_REGION in functions/.env.<alias> differs from the deployed one)' : 'unexpected answer from the functions endpoint',
      fix: 'firebase deploy --only functions --project <alias>   (see docs/ops.md, deploy order)',
    }
  } catch (e) {
    return {
      ...base, ok: false, detail: `could not reach ${url} (${e instanceof Error ? e.message : 'network error'})`,
      cause: 'no internet, a proxy blocking the call, or the project id/region is wrong', fix: 'check your connection, then re-run; confirm the project and FUNCTIONS_REGION',
    }
  }
}

/** `KEY=value` lines of a dotenv file; comments and blank lines ignored. Used for FUNCTIONS_REGION / APP_BASE_URL (no secrets live there). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1] as string] = (m[2] as string).replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

export const DEFAULT_FUNCTIONS_REGION = 'asia-south1'
