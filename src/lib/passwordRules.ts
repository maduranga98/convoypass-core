// Staff password rules for new passwords chosen in the app (workspace setup, reset link, account page).
// Mirrors `assertSetupPassword` in functions/src/setup.ts. Drivers and security have server-generated PINs (Module 12).
import { isCommonPassword } from './commonPasswords'
import { PASSWORD_MAX_LENGTH } from './credentials'

export const STAFF_PASSWORD_MIN_LENGTH = 10

export interface PasswordChecks {
  length: boolean
  notEmail: boolean
  notCommon: boolean
}

/** `email` may be empty when it is not known; "not your email" then passes. */
export function checkStaffPassword(password: string, email: string = ''): PasswordChecks {
  const e = email.trim().toLowerCase()
  return {
    length: password.length >= STAFF_PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    notEmail: e === '' || password.toLowerCase() !== e,
    // An empty password is not "common"; it simply fails the length rule.
    notCommon: password === '' || !isCommonPassword(password),
  }
}

export const passwordAcceptable = (c: PasswordChecks): boolean => c.length && c.notEmail && c.notCommon
