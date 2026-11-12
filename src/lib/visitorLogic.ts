// Keep in sync with functions/src/visitorLogic.ts (a test compares them).
// Visitor / pedestrian passes: the pure rules, with no Firebase imports. Mirrored in src/lib/visitorLogic.ts (a test
// compares the two copies). Everything the functions and the screens must agree on lives here: pass codes, validity
// windows, the plan cap, dwell, and what a pass "is" right now.
import { dateKey } from './dates'
import { isoFromDateKey } from './expiry'
import { endOfDayMs } from './penaltyLogic'

export const VISITOR_PASS_STATUSES = ['active', 'checked_in', 'checked_out', 'expired', 'revoked'] as const
export type VisitorPassStatus = (typeof VISITOR_PASS_STATUSES)[number]

// ---- Plan cap ----------------------------------------------------------------------------------------------------

export const VISITOR_PLANS = ['starter', 'growth', 'compliance'] as const
export type VisitorPlan = (typeof VISITOR_PLANS)[number]
/** Starter: this many NEW passes a calendar month (company timezone). Growth and Compliance are unlimited. */
export const STARTER_MONTHLY_CAP = 20

/**
 * The company's plan, read from `tenants.plan`. A company with no plan recorded (every workspace that predates plans) is
 * not capped; a recorded value that is not a known plan is treated as Starter, the safe side.
 */
export function planOf(tenant: { plan?: unknown } | null | undefined): VisitorPlan {
  const p = tenant?.plan
  if (p === undefined || p === null) return 'growth'
  return (VISITOR_PLANS as readonly unknown[]).includes(p) ? (p as VisitorPlan) : 'starter'
}

/** Passes a plan allows per month, or `null` for unlimited. */
export const monthlyCap = (plan: VisitorPlan): number | null => (plan === 'starter' ? STARTER_MONTHLY_CAP : null)

/** `YYYYMM` of `at` in the company timezone: the month a pass is counted in (`visitorPassUsage/{tenantId}_{yyyyMM}`). */
export const yearMonthOf = (timezone: string, at: Date): string => dateKey(timezone, at).slice(0, 6)

// ---- Settings (admin) ----------------------------------------------------------------------------------------------

export const DEFAULT_MAX_DWELL_MINUTES = 480
export const MIN_MAX_DWELL_MINUTES = 30
export const MAX_MAX_DWELL_MINUTES = 1440
export const DEFAULT_VALID_DAYS = 1
export const MAX_VALID_DAYS = 30

export interface VisitorSettings {
  /** Minutes a visitor may stay checked in before the pass is flagged (a flag only: nothing is closed or blocked). */
  maxDwellMinutes: number
  /** Days a new pass is valid by default (1 = the day it is issued). */
  defaultValidDays: number
}

const intIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

export const maxDwellOk = (v: unknown): v is number => intIn(v, MIN_MAX_DWELL_MINUTES, MAX_MAX_DWELL_MINUTES)
export const validDaysOk = (v: unknown): v is number => intIn(v, 1, MAX_VALID_DAYS)

/** The company's settings with defaults for anything absent or out of range. */
export function visitorSettingsOf(tenant: { visitorSettings?: { maxDwellMinutes?: unknown; defaultValidDays?: unknown } } | null | undefined): VisitorSettings {
  const s = tenant?.visitorSettings
  return {
    maxDwellMinutes: maxDwellOk(s?.maxDwellMinutes) ? s.maxDwellMinutes : DEFAULT_MAX_DWELL_MINUTES,
    defaultValidDays: validDaysOk(s?.defaultValidDays) ? s.defaultValidDays : DEFAULT_VALID_DAYS,
  }
}

// ---- Pass codes ----------------------------------------------------------------------------------------------------

/** 32 characters without 0, O, 1, I: a code read aloud or typed from a slip is never ambiguous. */
export const PASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PASS_CODE_LENGTH = 8
const PASS_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

/** What was typed or scanned -> the bare code, or null. Case, spaces and dashes are ignored. */
export function normalisePassCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '')
  return PASS_CODE_RE.test(code) ? code : null
}

/** `ABCD-EFGH`: how a code is shown and printed. */
export const formatPassCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`

/**
 * The pass code in a scanned QR, or null when it is not ours. Accepts `${baseUrl}/vp/{code}` (trailing slash, query and
 * hash tolerated) or a bare code. A URL on another origin or path prefix is refused.
 */
export function parseVisitorQr(text: string, baseUrl: string | null): string | null {
  const raw = text.trim()
  const bare = normalisePassCode(raw)
  if (bare && !/[/:.]/.test(raw)) return bare
  if (!baseUrl) return null
  let url: URL
  let base: URL
  try {
    url = new URL(raw)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (url.origin !== base.origin) return null
  const prefix = base.pathname.replace(/\/+$/, '')
  const match = url.pathname.match(/^(.*)\/vp\/([^/]+)\/?$/)
  if (!match || match[1] !== prefix) return null
  return normalisePassCode(decodeURIComponent(match[2] ?? ''))
}

/** The content of a pass QR code. Only the code, never a name or a number. */
export const visitorQrPayload = (baseUrl: string, code: string): string => `${baseUrl.replace(/\/+$/, '')}/vp/${code}`

// ---- Validity window ----------------------------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/

export const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Furthest ahead a pass may start. */
export const MAX_START_AHEAD_DAYS = 60

export type WindowResult = { ok: true; from: number; until: number; fromDate: string; untilDate: string } | { ok: false }

/**
 * The validity window of a new pass. Dates are calendar days (`YYYY-MM-DD`) in the company timezone: the pass is valid
 * from the first millisecond of `fromDate` to the last of `untilDate`. Default: today for the company's default number of
 * days. A pass cannot start in the past or end before it starts, and spans at most `MAX_VALID_DAYS`.
 */
export function validityWindow(timezone: string, nowMs: number, input: { validFrom?: string | undefined; validUntil?: string | undefined }, defaultDays: number): WindowResult {
  const today = isoFromDateKey(dateKey(timezone, new Date(nowMs)))
  const fromDate = input.validFrom ?? today
  if (!ISO.test(fromDate)) return { ok: false }
  const untilDate = input.validUntil ?? addDaysIso(fromDate, defaultDays - 1)
  if (!ISO.test(untilDate)) return { ok: false }
  const span = daysBetween(fromDate, untilDate)
  const ahead = daysBetween(today, fromDate)
  if (Number.isNaN(span) || Number.isNaN(ahead) || span < 0 || span >= MAX_VALID_DAYS || ahead < 0 || ahead > MAX_START_AHEAD_DAYS) return { ok: false }
  return { ok: true, fromDate, untilDate, from: endOfDayMs(timezone, addDaysIso(fromDate, -1)) + 1, until: endOfDayMs(timezone, untilDate) }
}

// ---- What a pass is right now -------------------------------------------------------------------------------------

export interface PassTimes {
  status: VisitorPassStatus
  validFrom: number
  validUntil: number
  checkInAt?: number | null
  maxDwellMinutes: number
}

/** A pass the schedule has not yet flipped still reads as expired once its last millisecond has passed. */
export const effectiveStatus = (p: Pick<PassTimes, 'status' | 'validUntil'>, nowMs: number): VisitorPassStatus =>
  p.status === 'active' && nowMs > p.validUntil ? 'expired' : p.status

export type EntryCheck = 'ok' | 'not-active' | 'not-yet-valid' | 'expired'

/** Can this pass be used to check in right now? (`not-active` covers checked in, checked out and revoked: see `status`.) */
export function entryCheck(p: Pick<PassTimes, 'status' | 'validFrom' | 'validUntil'>, nowMs: number): EntryCheck {
  if (p.status === 'expired') return 'expired'
  if (p.status !== 'active') return 'not-active'
  if (nowMs < p.validFrom) return 'not-yet-valid'
  if (nowMs > p.validUntil) return 'expired'
  return 'ok'
}

/** Whole minutes a checked-in visitor has been on site (never negative). */
export const dwellMinutes = (checkInAt: number, nowMs: number): number => Math.max(0, Math.floor((nowMs - checkInAt) / 60_000))

/** True for a checked-in visitor past the limit. Always a flag: nothing is closed or blocked because of it. */
export const isOverstay = (p: Pick<PassTimes, 'status' | 'checkInAt' | 'maxDwellMinutes'>, nowMs: number): boolean =>
  p.status === 'checked_in' && typeof p.checkInAt === 'number' && dwellMinutes(p.checkInAt, nowMs) > p.maxDwellMinutes

/** Uppercase letters and digits of an id number (4+), or null: the search key of a returning visitor. */
export const idKeyOf = (idNumber: string | null | undefined): string | null => {
  const key = (idNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key.length >= 4 ? key : null
}
