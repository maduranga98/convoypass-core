// Keep in sync with functions/src/defaultChecklist.ts (functions deploy from their own folder).

export interface ChecklistItemDef {
  id: string
  label: string
  /** When true, answering "No" blocks submission. */
  failBlocks: boolean
}

/** Used when the tenant has not configured its own checklist. */
export const DEFAULT_CHECKLIST: readonly ChecklistItemDef[] = [
  { id: 'dashcam_recording', label: 'Dashcam is recording', failBlocks: false },
  { id: 'dashcam_card', label: 'Dashcam memory card is inserted', failBlocks: false },
  { id: 'dashcam_lens', label: 'Dashcam lens is clean and clear', failBlocks: false },
  { id: 'gps_online', label: 'GPS device is powered and online', failBlocks: false },
  { id: 'gps_mounted', label: 'GPS device is mounted and visible', failBlocks: false },
]

export interface PassSettings {
  requireLocation: boolean
  /** 0 to 2. */
  maxExtraPhotos: number
}

export const DEFAULT_PASS_SETTINGS: PassSettings = { requireLocation: false, maxExtraPhotos: 2 }
