import { FirebaseError } from 'firebase/app'
import type { FunctionsError } from 'firebase/functions'
import { strings } from './strings'

/** Sign-in errors. Credential problems all collapse to one message so accounts cannot be enumerated. */
export function authErrorMessage(e: unknown): string {
  const code = e instanceof FirebaseError ? e.code : ''
  switch (code) {
    case 'auth/user-disabled':
      return strings.authErrors.accountUnavailable
    case 'auth/too-many-requests':
      return strings.authErrors.tooManyAttempts
    case 'auth/network-request-failed':
      return strings.authErrors.network
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/missing-password':
      return strings.authErrors.invalidCredentials
    default:
      return strings.authErrors.generic
  }
}

type ApiReason = keyof typeof strings.apiErrors

const isApiReason = (v: unknown): v is ApiReason =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(strings.apiErrors, v)

/** The stable `details.reason` set by our Cloud Functions, if any. */
export function apiErrorReason(e: unknown): ApiReason | null {
  if (!(e instanceof FirebaseError)) return null
  const details = (e as FunctionsError).details
  const reason = typeof details === 'object' && details !== null ? (details as { reason?: unknown }).reason : null
  return isApiReason(reason) ? reason : null
}

/** Cloud Function / Firestore errors -> user-facing copy. */
export function apiErrorMessage(e: unknown): string {
  const reason = apiErrorReason(e)
  if (reason) return strings.apiErrors[reason]
  if (e instanceof FirebaseError) {
    if (e.code === 'functions/unauthenticated') return strings.apiErrors.unauthenticated
    if (e.code === 'functions/permission-denied' || e.code === 'permission-denied') return strings.apiErrors.forbidden
    if (e.code === 'functions/invalid-argument') return strings.apiErrors['invalid-input']
    if (e.code === 'functions/unavailable' || e.code === 'unavailable') return strings.authErrors.network
  }
  return strings.common.somethingWrong
}

/**
 * Why a read failed, in words an administrator can act on. Firestore reports the cause in `error.code`:
 * a missing composite index and undeployed security rules both look like "no data" on screen, so the banner names them.
 */
export function describeLoadError(e: unknown): string | null {
  if (!(e instanceof FirebaseError)) return null
  const code = e.code.replace(/^(functions|firestore|storage)\//, '')
  if (import.meta.env.DEV) console.error('[load failed]', e.code, e.message)
  switch (code) {
    case 'permission-denied':
      return strings.loadErrors.permission
    case 'failed-precondition':
      return /index/i.test(e.message) ? strings.loadErrors.index : null
    case 'unavailable':
    case 'deadline-exceeded':
    case 'network-request-failed':
      return strings.loadErrors.network
    case 'unauthenticated':
      return strings.loadErrors.session
    case 'resource-exhausted':
      return strings.loadErrors.quota
    default:
      return null
  }
}
