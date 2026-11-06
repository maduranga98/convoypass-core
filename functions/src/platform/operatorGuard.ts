// `requireOperator`: the one guard every platform callable goes through.
//   - signed in, claims exactly `{ role: 'platform', platformAdmin: true }`
//   - verified email
//   - an existing, active `operators/{uid}` doc (a disabled operator is refused even with a live ID token)
//   - for MUTATING calls, a sign-in no older than 15 minutes (`reauth-required`, so the UI can ask for the password)
// Every refusal except reauth is the same `permission-denied` / `forbidden`: a tenant admin learns nothing about operators.
import { fail } from '../errors.js'

export const OPERATOR_REAUTH_SECONDS = 15 * 60

export interface OperatorRecord {
  name: string
  email: string
  status: 'active' | 'disabled'
  /** Set by `superadmin:create` with a generated password and by `--reset-password`; cleared by `changeOwnPassword`. */
  mustChangePassword?: boolean
}

export interface OperatorPort {
  getOperator(uid: string): Promise<OperatorRecord | null>
}

/** What the guard reads from a callable request: `request.auth`. */
export interface AuthLike {
  uid: string
  token: Record<string, unknown>
}

export interface OperatorCaller {
  uid: string
  name: string
  email: string
  mustChangePassword: boolean
}

const forbidden = () => fail('permission-denied', 'forbidden', 'Not allowed')

export async function requireOperator(
  auth: AuthLike | undefined,
  port: OperatorPort,
  opts: { mutating: boolean; nowSeconds: number },
): Promise<OperatorCaller> {
  if (!auth) throw fail('unauthenticated', 'unauthenticated', 'Sign in required')
  const { token } = auth
  if (token.platformAdmin !== true || token.role !== 'platform') throw forbidden()
  // Operators never belong to a tenant: a token that has one is not an operator token.
  if (token.tenantId !== undefined && token.tenantId !== null) throw forbidden()
  if (token.email_verified !== true) throw forbidden()
  const operator = await port.getOperator(auth.uid)
  if (!operator || operator.status !== 'active') throw forbidden()
  if (opts.mutating) {
    const authTime = typeof token.auth_time === 'number' ? token.auth_time : 0
    if (opts.nowSeconds - authTime > OPERATOR_REAUTH_SECONDS) {
      throw fail('unauthenticated', 'reauth-required', 'Please sign in again to continue')
    }
  }
  return { uid: auth.uid, name: operator.name, email: operator.email, mustChangePassword: operator.mustChangePassword === true }
}
