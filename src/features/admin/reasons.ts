import { MAX_QUALIFICATION_TYPES, QUALIFICATION_NAME_MAX, QUALIFICATION_NAME_MIN } from '@/lib/requirementLogic'
import { MAX_EXPIRY_WARNING_DAYS, MIN_EXPIRY_WARNING_DAYS } from '@/lib/expiry'
import { MAX_VEHICLE_TYPES, VEHICLE_TYPE_NAME_MAX, VEHICLE_TYPE_NAME_MIN } from '@/lib/vehicleTypes'
import { SLA_MAX, SLA_MIN, type SlaSettings } from '@/lib/defaultSla'
import { GATE_NAME_MAX, GATE_NAME_MIN } from '@/lib/gates'

export const MIN_REASONS = 2
export const MAX_REASONS = 10

/** Ids are generated once, when a reason is added, and never edited: rejected passes keep the code they were rejected with. */
export const newReasonId = (): string => `custom_${Math.random().toString(36).slice(2, 8)}`
export const reasonLabelOk = (label: string): boolean => label.trim().length >= 3 && label.trim().length <= 60

/** Gate ids are created once, when a gate is added, and never edited: check-ins and denials keep the gate id. */
export const newGateId = (): string => `gate_${Math.random().toString(36).slice(2, 8)}`
export const gateNameOk = (name: string): boolean => name.trim().length >= GATE_NAME_MIN && name.trim().length <= GATE_NAME_MAX

export const minutesOk = (m: number): boolean => Number.isInteger(m) && m >= SLA_MIN && m <= SLA_MAX

export const slaOk = (sla: SlaSettings): boolean => minutesOk(sla.supervisorMinutes) && minutesOk(sla.officerMinutes)

export const RETENTION_MIN = 30
export const RETENTION_MAX = 3650
export const DEFAULT_RETENTION_DAYS = 365

/** 0 (keep forever) or a whole number of days from 30 to 3650. */
export const retentionOk = (days: number): boolean => days === 0 || (Number.isInteger(days) && days >= RETENTION_MIN && days <= RETENTION_MAX)

export const vehicleTypeNameOk = (name: string): boolean =>
  name.trim().length >= VEHICLE_TYPE_NAME_MIN && name.trim().length <= VEHICLE_TYPE_NAME_MAX

/** Every name is valid and no two are equal ignoring case; 1 to 30 names. */
export const vehicleTypesOk = (names: string[]): boolean =>
  names.length >= 1 &&
  names.length <= MAX_VEHICLE_TYPES &&
  names.every(vehicleTypeNameOk) &&
  new Set(names.map((n) => n.trim().toLowerCase())).size === names.length

export const expiryDaysOk = (n: number): boolean => Number.isInteger(n) && n >= MIN_EXPIRY_WARNING_DAYS && n <= MAX_EXPIRY_WARNING_DAYS

/** Required qualifications: each name 2-60 characters, unique ignoring case, at most 12; an empty list requires none. */
export const qualificationNameOk = (name: string): boolean =>
  name.trim().length >= QUALIFICATION_NAME_MIN && name.trim().length <= QUALIFICATION_NAME_MAX

export const qualificationTypesOk = (items: readonly { name: string }[]): boolean =>
  items.length <= MAX_QUALIFICATION_TYPES &&
  items.every((i) => qualificationNameOk(i.name)) &&
  new Set(items.map((i) => i.name.trim().toLowerCase())).size === items.length

/** Ids are generated once when an item is added and never edited: drivers keep their records under the id. */
export const newQualificationId = (): string => `q_${Math.random().toString(36).slice(2, 10)}`
