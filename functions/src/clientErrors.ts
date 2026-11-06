import { z } from 'zod'
import { parse, type Deps } from './core.js'
import { logWarn } from './logger.js'
import type { Caller } from './types.js'

export const MAX_MESSAGE = 300
export const MAX_STACK = 1500
export const MAX_ROUTE = 80

export const reportClientErrorSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(10_000).optional(),
  route: z.string().max(500).optional(),
  source: z.enum(['boundary', 'window', 'promise', 'gate', 'form']),
  appVersion: z.string().max(40).optional(),
})

/**
 * Removes what could identify a person or open a door, then truncates: emails, phone-like numbers, JWTs and other long
 * tokens, UUIDs, vehicle ids, and URLs (kept as their path only: no host, no query, no fragment).
 */
export function scrubText(text: string, max: number): string {
  return text
    .replace(/https?:\/\/[^\s/)]+(\/[^\s?#)]*)?(\?[^\s#)]*)?(#[^\s)]*)?/g, (_m, path: string | undefined) => path ?? '<url>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<token>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/veh_[a-z0-9]{10}/g, '<vehicle>')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '<number>')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<token>')
    .slice(0, max)
}

/** Pathname only, ids replaced: `/supervisor/approvals/veh_abcdefghij_20260310?x=1` -> `/supervisor/approvals/:id`. */
export function scrubRoute(route: string): string {
  const path = route.split(/[?#]/)[0] ?? ''
  return path
    .split('/')
    .map((seg) => (/^(veh_|den_)/.test(seg) || /\d{6,}/.test(seg) || seg.length > 30 ? ':id' : seg))
    .join('/')
    .slice(0, MAX_ROUTE)
}

/**
 * The browser reports a crash; this writes one structured log line (uid and tenant for correlation, nothing the
 * person typed). Rate limited by the caller wrapper, truncated and scrubbed here.
 */
export async function reportClientError(_deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(reportClientErrorSchema, raw)
  logWarn({ fn: 'reportClientError', uid: caller.uid, tenantId: caller.tenantId }, 'ok', {
    source: input.source,
    route: input.route ? scrubRoute(input.route) : undefined,
    message: scrubText(input.message, MAX_MESSAGE),
    stack: input.stack ? scrubText(input.stack, MAX_STACK) : undefined,
    appVersion: input.appVersion ? scrubText(input.appVersion, 40) : undefined,
    role: caller.role,
  })
  return { ok: true }
}
