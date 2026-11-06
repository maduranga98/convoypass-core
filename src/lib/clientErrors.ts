import { reportClientError } from './api'

export type ErrorSource = 'boundary' | 'window' | 'promise' | 'gate' | 'form'

const MAX_PER_PAGE_LOAD = 5
const DEDUPE_MS = 60_000
const seen = new Map<string, number>()
let sent = 0

const asError = (e: unknown): { message: string; stack?: string } =>
  e instanceof Error ? { message: `${e.name}: ${e.message}`, ...(e.stack ? { stack: e.stack } : {}) } : { message: typeof e === 'string' ? e : 'Non-error thrown' }

/**
 * Tells the server about a crash so it shows up in the logs. Best effort and quiet: never throws, never loops (the
 * same error is sent once a minute, five per page load), nothing is sent from a development build. The server scrubs
 * emails, numbers, tokens and URLs again and truncates; the page sends no user data of its own.
 */
export function logClientError(error: unknown, source: ErrorSource, route: string = typeof location === 'undefined' ? '' : location.pathname): void {
  if (import.meta.env.DEV) return
  try {
    const { message, stack } = asError(error)
    const key = `${source}:${message.slice(0, 120)}`
    const now = Date.now()
    if (sent >= MAX_PER_PAGE_LOAD || now - (seen.get(key) ?? 0) < DEDUPE_MS) return
    seen.set(key, now)
    sent++
    void reportClientError({ message: message.slice(0, 2000), ...(stack ? { stack: stack.slice(0, 10_000) } : {}), route, source }).catch(() => undefined)
  } catch {
    /* reporting must never break the page */
  }
}

/** Uncaught errors and unhandled promise rejections. Call once at startup. */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (e) => logClientError(e.error ?? e.message, 'window'))
  window.addEventListener('unhandledrejection', (e) => logClientError(e.reason, 'promise'))
}

/** Test hook. */
export function resetClientErrorLogging(): void {
  seen.clear()
  sent = 0
}
