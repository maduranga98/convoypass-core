import { logger } from 'firebase-functions/v2'

/**
 * Structured logging. Every line carries `fn`, `outcome` and, when known, `uid`, `tenantId`, `requestId`.
 * Nothing else is free text: extra fields must be short scalars, keys that look sensitive are dropped, and strings
 * that look like URLs, tokens or JWTs are masked, so names, phones, plates, photo URLs and credentials cannot leak
 * through a careless call. Errors are logged as `errorName` / `errorCode` only (messages can echo input).
 */
export type Outcome = 'ok' | 'denied' | 'error' | 'skipped' | 'rate-limited' | 'duplicate'

export interface LogContext {
  fn: string
  uid?: string | undefined
  tenantId?: string | undefined
  requestId?: string | undefined
}

export type LogExtra = Record<string, string | number | boolean | null | undefined>

const SENSITIVE_KEY = /passw|passphrase|pin$|^pin|token|secret|credential|authorization|cookie|url|phone|email|name$|photo|plate|payload|body/i
const MASKABLE = /https?:\/\/|data:|^eyJ|[A-Za-z0-9_-]{40,}/
const MAX_STRING = 120
/** A few keys carry longer text (a client error message and stack): they are scrubbed by their caller first. */
const LONG_KEYS: Record<string, number> = { message: 300, stack: 1500 }

export interface LogSink {
  info(message: string, fields: Record<string, unknown>): void
  warn(message: string, fields: Record<string, unknown>): void
  error(message: string, fields: Record<string, unknown>): void
}

let sink: LogSink = logger

/** Tests swap the sink; returns a restore function. */
export function setLogSink(next: LogSink): () => void {
  const previous = sink
  sink = next
  return () => {
    sink = previous
  }
}

const cleanString = (value: string, max: number = MAX_STRING): string =>
  MASKABLE.test(value) ? '[masked]' : value.length > max ? `${value.slice(0, max)}…` : value

/** Keeps short scalars only, drops sensitive keys, masks sensitive-looking strings. */
export function sanitiseExtra(extra: LogExtra = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || SENSITIVE_KEY.test(key)) continue
    out[key] = typeof value === 'string' ? cleanString(value, LONG_KEYS[key] ?? MAX_STRING) : value
  }
  return out
}

const fields = (ctx: LogContext, outcome: Outcome, extra?: LogExtra) => ({
  fn: ctx.fn,
  outcome,
  ...(ctx.uid ? { uid: ctx.uid } : {}),
  ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
  ...(ctx.requestId ? { requestId: cleanString(ctx.requestId) } : {}),
  ...sanitiseExtra(extra),
})

export function describeError(e: unknown): { errorName: string; errorCode?: string; errorDetail?: string } {
  const name = e instanceof Error ? e.name : typeof e
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined
  // Firestore/gRPC failures (numeric code) carry system text such as "The query requires an index"; keep it, minus URLs.
  const grpc = code !== undefined && /^\d+$/.test(code) && e instanceof Error
  const detail = grpc ? e.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 200) : undefined
  return { errorName: cleanString(name), ...(code ? { errorCode: cleanString(code) } : {}), ...(detail ? { errorDetail: detail } : {}) }
}

export const logInfo = (ctx: LogContext, outcome: Outcome, extra?: LogExtra): void =>
  sink.info(ctx.fn, fields(ctx, outcome, extra))

export const logWarn = (ctx: LogContext, outcome: Outcome, extra?: LogExtra): void =>
  sink.warn(ctx.fn, fields(ctx, outcome, extra))

export const logError = (ctx: LogContext, e: unknown, extra?: LogExtra): void =>
  sink.error(ctx.fn, { ...fields(ctx, 'error', extra), ...describeError(e) })
