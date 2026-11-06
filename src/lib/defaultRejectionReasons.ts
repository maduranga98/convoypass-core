// Keep in sync with functions/src/defaultRejectionReasons.ts (functions deploy from their own folder).

export interface RejectionReasonDef {
  id: string
  label: string
}

/** The reason that always exists and always needs a note. */
export const OTHER_REASON_ID = 'other'

/** Used when the tenant has not configured its own list. */
export const DEFAULT_REJECTION_REASONS: readonly RejectionReasonDef[] = [
  { id: 'gps_unclear', label: 'GPS photo unclear or device not visible' },
  { id: 'dashcam_unclear', label: 'Dashcam photo unclear or not recording' },
  { id: 'checklist_issue', label: 'Checklist problem needs fixing' },
  { id: 'wrong_vehicle', label: 'Photos do not match this vehicle' },
  { id: 'photo_not_fresh', label: 'Photo looks old or reused' },
  { id: OTHER_REASON_ID, label: 'Other (note required)' },
]

export const MIN_REASON_NOTE = 3
export const MAX_REASON_NOTE = 200
