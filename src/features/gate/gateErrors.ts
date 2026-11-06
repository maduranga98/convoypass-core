import { FirebaseError } from 'firebase/app'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { Classified } from './offlineQueue'

const t = strings.gate

/** `details` of a typed HttpsError from our functions (`reason` plus any extras), or null. */
export function errorDetails(e: unknown): Record<string, unknown> | null {
  if (!(e instanceof FirebaseError)) return null
  const details = (e as FirebaseError & { details?: unknown }).details
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : null
}

export const errorReason = (e: unknown): string | null => {
  const reason = errorDetails(e)?.reason
  return typeof reason === 'string' ? reason : null
}

/**
 * Worth retrying later: no connection, or no typed answer from our function (a callable that never reached the
 * server fails with `internal` and no details). A typed refusal (`details.reason`) is final.
 */
export function isRetryable(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const reason = errorReason(e)
  return reason === null || reason === 'internal'
}

const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Plain message for a gate call that failed: "Already checked in at 08:14 by Nimal", "This pass changed…". */
export function gateErrorMessage(e: unknown): string {
  const d = errorDetails(e)
  if (d?.reason === 'pass-checked-in' && typeof d.at === 'number' && typeof d.byName === 'string') {
    return t.alreadyCheckedIn(hhmm(d.at), d.byName)
  }
  return apiErrorMessage(e)
}

export const classifyGateError = (e: unknown): Classified =>
  isRetryable(e) ? { retry: true } : { retry: false, message: gateErrorMessage(e) }
