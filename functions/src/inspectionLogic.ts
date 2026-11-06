// Keep in sync with src/lib/inspectionLogic.ts (functions deploy from their own folder; src/lib/inspectionLogic.test.ts
// compares them). Pure: no firebase imports. The ONE place that decides what an inspection record means for a vehicle:
// cleared, needs re-inspection (and why), rejected, or never inspected. Times are milliseconds since epoch.
export const INSPECTION_RESULTS = ['approved', 'rejected'] as const
export type InspectionResult = (typeof INSPECTION_RESULTS)[number]

/** `active` = the vehicle's current record; `superseded` = a newer inspection replaced it; `invalidated` = cancelled by an event, no new inspection yet. */
export const INSPECTION_STATUSES = ['active', 'superseded', 'invalidated'] as const
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number]

export const INVALIDATION_REASONS = ['penalty_issued', 'document_expired', 'manual'] as const
export type InvalidationReason = (typeof INVALIDATION_REASONS)[number]

/** What the gate (later module) and the lists see for a vehicle. */
export const CLEARANCE_STATUSES = ['cleared', 'needs_reinspection', 'rejected', 'never_inspected'] as const
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number]

export const INSPECTION_NOTES_MAX = 1000
/** A rejection must say what was wrong. */
export const REJECTION_NOTE_MIN = 5

/** The part of an inspection record the rules below read. */
export interface InspectionLike {
  status: InspectionStatus
  result: InspectionResult
  invalidatedReason?: InvalidationReason | null | undefined
}

export interface Clearance {
  status: ClearanceStatus
  /** Why the vehicle needs re-inspection; null otherwise. */
  reason: InvalidationReason | null
}

/**
 * The clearance of a vehicle from its CURRENT inspection record (`null` = none). Only an active, approved record
 * clears a vehicle; an active rejection is "rejected"; an invalidated approval needs re-inspection. A superseded record
 * is never current, so it reads as no record.
 */
export function clearanceOf(current: InspectionLike | null | undefined): Clearance {
  if (!current || current.status === 'superseded') return { status: 'never_inspected', reason: null }
  if (current.status === 'invalidated') return { status: 'needs_reinspection', reason: current.invalidatedReason ?? 'manual' }
  return current.result === 'approved' ? { status: 'cleared', reason: null } : { status: 'rejected', reason: null }
}

export const isCleared = (current: InspectionLike | null | undefined): boolean => clearanceOf(current).status === 'cleared'

/**
 * May an event at `eventMs` cancel this record? Only an active approval that was recorded BEFORE the event: a delayed or
 * retried trigger must never cancel an inspection made after the problem was corrected.
 */
export function shouldInvalidate(current: (InspectionLike & { inspectedAt: number }) | null | undefined, eventMs: number): boolean {
  return !!current && current.status === 'active' && current.result === 'approved' && current.inspectedAt <= eventMs
}
