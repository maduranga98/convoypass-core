// Module 8: invite-only workspace setup. Two unauthenticated callables:
//   validateSetupInvite  does this code look usable? (`{ valid }`, never says why not)
//   completeSetup        one invite -> exactly one new tenant + its first admin (never joins an existing tenant)
// Every way a code can be unusable (wrong format, unknown, expired, used, claimed by someone else, locked to another
// email) gives the SAME `failed-precondition` / `setup-invalid` answer, so codes cannot be enumerated.
import { HttpsError } from 'firebase-functions/v2/https'
import { isCommonPassword } from './auth/commonPasswords.js'
import { parse, type AuthPort } from './core.js'
import { fail } from './errors.js'
import { logError } from './logger.js'
import { completeSetupSchema, validateSetupInviteSchema } from './schemas.js'
import { hashInviteCode, INVITE_CODE_PATTERN } from './tenants/inviteCode.js'
import { DEFAULT_TIMEZONE, type ProvisionInput } from './tenants/tenantDefaults.js'

export const SETUP_PASSWORD_MIN_LENGTH = 10
export const SETUP_INVALID_MESSAGE = 'This setup link is invalid or has expired.'
export const setupInvalid = () => fail('failed-precondition', 'setup-invalid', SETUP_INVALID_MESSAGE)

/** What a lookup reveals about an invite. Never contains the code. */
export interface InviteView {
  /** Usable right now: exists, not used, not expired. (A live claim by another visitor does not change this.) */
  usable: boolean
  companyHint?: string
  emailLock?: string
}

/** Thrown by the port when the claim is no longer ours at commit time (it expired and someone else took it). */
export class ClaimLostError extends Error {}

/** Storage side of setup (Firestore transactions in `setupPort.ts`, an in-memory fake in tests). */
export interface SetupPort {
  lookupInvite(hash: string, nowMs: number): Promise<InviteView | null>
  /** Transaction: claim only when the invite exists, is unused, unexpired, unclaimed (or claimed > 10 min ago) and the email lock matches. */
  claimInvite(p: { hash: string; claimId: string; email: string; nowMs: number }): Promise<boolean>
  /** Clears the claim, only if it is still ours. */
  releaseClaim(hash: string, claimId: string): Promise<void>
  /**
   * ONE transaction: the claim must still be ours and the invite unused; then provisions tenant + admin user + audit
   * entries (provisionTenant) and marks the invite used (`usedAt`, `tenantId`, `claimId` cleared). Throws ClaimLostError.
   */
  commitSetup(p: { hash: string; claimId: string; input: Omit<ProvisionInput, 'createdAt'> }): Promise<void>
}

export interface SetupDeps {
  auth: AuthPort
  port: SetupPort
  now: () => number
  newTenantId: () => string
  newClaimId: () => string
  timezones: () => ReadonlySet<string>
}

export const supportedTimezones = (): ReadonlySet<string> => new Set([...Intl.supportedValuesOf('timeZone'), DEFAULT_TIMEZONE])

const codeOf = (raw: unknown): string => {
  const v = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown }).code : undefined
  if (typeof v !== 'string' || !INVITE_CODE_PATTERN.test(v)) throw setupInvalid()
  return v
}

// ---- validateSetupInvite ---------------------------------------------------------------------

export async function validateSetupInvite(
  deps: SetupDeps,
  raw: unknown,
): Promise<{ valid: boolean; companyHint?: string; emailLock?: string }> {
  let code: string
  try {
    code = codeOf(raw)
    parse(validateSetupInviteSchema, raw)
  } catch {
    return { valid: false }
  }
  const invite = await deps.port.lookupInvite(hashInviteCode(code), deps.now())
  if (!invite?.usable) return { valid: false }
  return {
    valid: true,
    ...(invite.companyHint ? { companyHint: invite.companyHint } : {}),
    ...(invite.emailLock ? { emailLock: invite.emailLock } : {}),
  }
}

// ---- completeSetup ---------------------------------------------------------------------------

/** Password rules for a new workspace admin. Mirrored in `src/lib/passwordRules.ts`. */
export function assertSetupPassword(password: string, email: string): void {
  if (password.length < SETUP_PASSWORD_MIN_LENGTH) throw fail('invalid-argument', 'weak-password', `Password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters`)
  if (password.toLowerCase() === email) throw fail('invalid-argument', 'password-is-email', 'Password must not be your email')
  if (isCommonPassword(password)) throw fail('invalid-argument', 'common-password', 'That password is too common')
}

const errorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined

export async function completeSetup(deps: SetupDeps, raw: unknown): Promise<{ tenantId: string }> {
  // 1. The code first: anything wrong with it (even its format) is the uniform answer.
  const code = codeOf(raw)
  const input = parse(completeSetupSchema, raw)
  assertSetupPassword(input.password, input.email)
  const timezone = input.timezone || DEFAULT_TIMEZONE
  if (!deps.timezones().has(timezone)) throw fail('invalid-argument', 'timezone-invalid', 'Unknown timezone')

  const hash = hashInviteCode(code)
  const claimId = deps.newClaimId()
  const tenantId = deps.newTenantId()

  // 2. Claim the invite (transaction). Two visitors with one code: exactly one gets past here.
  if (!(await deps.port.claimInvite({ hash, claimId, email: input.email, nowMs: deps.now() }))) throw setupInvalid()

  let uid: string | null = null
  try {
    // 3. The Auth user. An existing email releases the claim, so the same link works again with another email.
    try {
      ;({ uid } = await deps.auth.createUser({ email: input.email, password: input.password, displayName: input.adminName }))
    } catch (e) {
      if (errorCode(e) === 'auth/email-already-exists') {
        await deps.port.releaseClaim(hash, claimId).catch(() => undefined)
        throw fail('already-exists', 'email-exists', 'An account with this email already exists.')
      }
      throw e
    }
    // 4. Claims, then tenant + admin doc + audit + invite marked used, all in one transaction.
    await deps.auth.setCustomUserClaims(uid, { role: 'admin', tenantId })
    await deps.port.commitSetup({
      hash,
      claimId,
      input: {
        tenantId,
        tenantName: input.companyName,
        timezone,
        admin: { uid, name: input.adminName, email: input.email, mustChangePassword: false, createdBy: 'setup' },
        actor: { uid: 'setup', role: 'system' },
      },
    })
  } catch (e) {
    if (e instanceof HttpsError) throw e // our own typed refusal (email-exists): already cleaned up
    // Anything else after the claim: no orphaned Auth user, claim released, the real error stays on the server.
    if (uid) await deps.auth.deleteUser(uid).catch(() => undefined)
    await deps.port.releaseClaim(hash, claimId).catch(() => undefined)
    logError({ fn: 'completeSetup' }, e)
    throw fail('internal', 'internal', 'Could not complete setup')
  }
  return { tenantId }
}
