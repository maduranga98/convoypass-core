// New password for a super admin (the forced change page and the later "Change password"). Mirrors `changeOwnPassword`
// for platform users in functions/src/platform/platform.ts: 14+ characters, not the email, not a common password.
import { isCommonPassword } from './commonPasswords'
import { PASSWORD_MAX_LENGTH } from './credentials'

export const OPERATOR_PASSWORD_MIN_LENGTH = 14

export interface OperatorPasswordChecks {
  length: boolean
  notEmail: boolean
  notCommon: boolean
}

export function checkOperatorPassword(password: string, email: string = ''): OperatorPasswordChecks {
  const e = email.trim().toLowerCase()
  return {
    length: password.length >= OPERATOR_PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    notEmail: e === '' || password.toLowerCase() !== e,
    notCommon: password === '' || !isCommonPassword(password),
  }
}

export const operatorPasswordAcceptable = (c: OperatorPasswordChecks): boolean => c.length && c.notEmail && c.notCommon
