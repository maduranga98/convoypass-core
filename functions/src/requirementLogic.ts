// Keep in sync with src/lib/requirementLogic.ts (functions deploy from their own folder; src/lib/requirementLogic.test.ts
// compares them). Pure: no firebase imports. The ONE place for the three "paper" requirements that sit beside the
// document dates of Module 2: a driver's qualifications (safety, defensive driving, work instruction, ...; valid one year),
// a vehicle's annual inspection (a validity date, required) and a driver's permit numbers (valid three months, information only).
import { daysUntil, isExpiryDate } from './expiry.js'

// ---- Qualifications (driver) ------------------------------------------------------------------------

/** A condition every driver must hold to be eligible. The company edits this list; removing one stops requiring it. */
export interface QualificationTypeDef {
  id: string
  name: string
}

export const QUALIFICATION_ID_PATTERN = /^[a-z0-9_]{2,40}$/
export const QUALIFICATION_NAME_MIN = 2
export const QUALIFICATION_NAME_MAX = 60
export const MAX_QUALIFICATION_TYPES = 12
export const QUALIFICATION_VALID_MONTHS = 12

/** Used until the company saves its own list (and by `provisionTenant`). Ids never change. */
export const DEFAULT_QUALIFICATION_TYPES: readonly QualificationTypeDef[] = [
  { id: 'safety', name: 'Safety induction' },
  { id: 'defensive_driving', name: 'Defensive driving (DD)' },
  { id: 'work_instruction', name: 'Work instruction' },
]

/** The configured list, or the defaults when the tenant never saved one. An explicitly empty list is respected. */
export const effectiveQualificationTypes = (stored: readonly QualificationTypeDef[] | undefined): QualificationTypeDef[] =>
  (stored ?? DEFAULT_QUALIFICATION_TYPES).map((t) => ({ id: t.id, name: t.name }))

/** What the Admin or Officer recorded for one driver and one type. Re-recording replaces it. */
export interface QualificationRecord {
  /** `YYYY-MM-DD`: the day the training was completed. */
  completedOn: string
  /** `YYYY-MM-DD`: valid through the end of this day. */
  expiresOn: string
  recordedByUid: string
  recordedByName: string
  /** Milliseconds since epoch. */
  recordedAt: number
}

export type QualificationRecords = Record<string, QualificationRecord>

/** `2026-02-28` + 12 months -> `2027-02-28`; a 29 February clamps to the last day of the target month. */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + months
  const year = y + Math.floor(m / 12)
  const month = ((m % 12) + 12) % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(Number(iso.slice(8, 10)), last)
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const qualificationExpiry = (completedOn: string): string => addMonths(completedOn, QUALIFICATION_VALID_MONTHS)

export type QualificationState = 'valid' | 'expiringSoon' | 'expired' | 'missing'

/** One type for one driver. `expiringSoon` uses the company's warning window, like the other documents. */
export function qualificationState(record: Pick<QualificationRecord, 'expiresOn'> | undefined | null, today: string, warningDays: number): QualificationState {
  if (!record || !isExpiryDate(record.expiresOn)) return 'missing'
  const left = daysUntil(record.expiresOn, today)
  if (left < 0) return 'expired'
  return left <= warningDays ? 'expiringSoon' : 'valid'
}

export interface QualificationStanding {
  /** Names of required types the driver has never been recorded for. */
  missing: string[]
  /** Names of required types whose validity ended. */
  expired: string[]
  /** True when every required type is held and valid (an empty list requires nothing). */
  ok: boolean
}

export function qualificationStanding(
  types: readonly QualificationTypeDef[],
  records: QualificationRecords | null | undefined,
  today: string,
  warningDays: number,
): QualificationStanding {
  const missing: string[] = []
  const expired: string[] = []
  for (const t of types) {
    const s = qualificationState(records?.[t.id], today, warningDays)
    if (s === 'missing') missing.push(t.name)
    else if (s === 'expired') expired.push(t.name)
  }
  return { missing, expired, ok: missing.length === 0 && expired.length === 0 }
}

// ---- Annual vehicle inspection ------------------------------------------------------------------------

export type AnnualInspectionState = 'valid' | 'expiringSoon' | 'expired' | 'missing'

/** The inspection is only a validity date: valid through the end of that day. No date = never inspected = `missing`. */
export function annualInspectionState(expiry: string | null | undefined, today: string, warningDays: number): AnnualInspectionState {
  if (!isExpiryDate(expiry)) return 'missing'
  const left = daysUntil(expiry, today)
  if (left < 0) return 'expired'
  return left <= warningDays ? 'expiringSoon' : 'valid'
}

/** A vehicle without a valid annual inspection cannot be assigned, get a gate pass or check in. */
export const annualInspectionOk = (state: AnnualInspectionState): boolean => state === 'valid' || state === 'expiringSoon'

// ---- Permit numbers (driver, information only) --------------------------------------------------------

export const MAX_PERMITS = 2
export const PERMIT_VALID_MONTHS = 3
export const PERMIT_NUMBER_MIN = 3
export const PERMIT_NUMBER_MAX = 30

export interface PermitRecord {
  /** Uppercase, single spaces. */
  number: string
  /** `YYYY-MM-DD`: the day the driver entered it. */
  enteredOn: string
  /** `YYYY-MM-DD`: valid through the end of this day (three months after `enteredOn`). */
  expiresOn: string
}

export const normalisePermitNumber = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toUpperCase()

export const permitExpiry = (enteredOn: string): string => addMonths(enteredOn, PERMIT_VALID_MONTHS)

export type PermitState = 'valid' | 'expiringSoon' | 'expired'

export function permitState(p: Pick<PermitRecord, 'expiresOn'>, today: string, warningDays: number): PermitState {
  const left = daysUntil(p.expiresOn, today)
  if (left < 0) return 'expired'
  return left <= warningDays ? 'expiringSoon' : 'valid'
}
