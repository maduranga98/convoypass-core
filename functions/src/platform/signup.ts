// Open super admin signup (the /platform/signup page). Public: no sign-in, a per-IP rate limit, and a server-side switch
// (`SUPERADMIN_SIGNUP_ENABLED`: always on in the emulator, `ALLOW_SUPERADMIN_SIGNUP=true` elsewhere). The new account is
// exactly what `superadmin:create` makes: verified email, claims { role: 'platform', platformAdmin: true } and no tenant,
// an active `operators/{uid}` profile and a `platformAuditLog` entry (`actorUid: 'signup'`). The password is never stored,
// logged or audited.
import { isCommonPassword } from '../auth/commonPasswords.js'
import { parse } from '../core.js'
import { fail } from '../errors.js'
import { signUpSuperAdminSchema } from '../schemas.js'
import { OPERATOR_PASSWORD_MIN_LENGTH } from './platform.js'
import { platformAudit, type PlatformAuditEntry } from './platformAudit.js'

export interface SignupAuthPort {
  createUser(p: { email: string; password: string; displayName: string; emailVerified: true }): Promise<{ uid: string }>
  setCustomUserClaims(uid: string, claims: { role: 'platform'; platformAdmin: true }): Promise<void>
  deleteUser(uid: string): Promise<void>
}

export interface SignupPort {
  /** Any `operators` or tenant `users` document already has this email. */
  emailInUse(email: string): Promise<boolean>
  /** Creates `operators/{uid}` and its audit entry together. */
  createOperator(uid: string, doc: { name: string; email: string }, audit: PlatformAuditEntry): Promise<void>
}

export interface SignupDeps {
  enabled: () => boolean
  auth: SignupAuthPort
  port: SignupPort
}

const errorCode = (e: unknown): string | undefined => (typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined)

export const signupStatus = (deps: Pick<SignupDeps, 'enabled'>): { enabled: boolean } => ({ enabled: deps.enabled() })

export async function signUpSuperAdmin(deps: SignupDeps, raw: unknown): Promise<{ ok: true }> {
  if (!deps.enabled()) throw fail('permission-denied', 'signup-disabled', 'Super admin signup is turned off')
  const input = parse(signUpSuperAdminSchema, raw)
  if (input.password.length < OPERATOR_PASSWORD_MIN_LENGTH) throw fail('invalid-argument', 'weak-password', 'Password is too short')
  if (input.password.toLowerCase() === input.email) throw fail('invalid-argument', 'password-is-email', 'Password cannot be the email')
  if (isCommonPassword(input.password)) throw fail('invalid-argument', 'common-password', 'Password is too common')

  const taken = () => fail('already-exists', 'email-exists', 'An account with this email already exists.')
  if (await deps.port.emailInUse(input.email)) throw taken()

  let uid: string
  try {
    ;({ uid } = await deps.auth.createUser({ email: input.email, password: input.password, displayName: input.name, emailVerified: true }))
  } catch (e) {
    if (errorCode(e) === 'auth/email-already-exists') throw taken()
    throw e
  }
  try {
    await deps.auth.setCustomUserClaims(uid, { role: 'platform', platformAdmin: true })
    await deps.port.createOperator(uid, { name: input.name, email: input.email }, platformAudit('signup', 'operator.created', uid, { source: 'signup' }))
  } catch {
    await deps.auth.deleteUser(uid).catch(() => undefined) // no half-made super admin
    throw fail('internal', 'internal', 'Could not create the account')
  }
  return { ok: true }
}
