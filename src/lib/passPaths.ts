export const EVIDENCE_FILES = ['gps.jpg', 'dashcam.jpg', 'extra1.jpg', 'extra2.jpg'] as const
export type EvidenceFileName = (typeof EVIDENCE_FILES)[number]

/** The only Storage path an evidence photo may live at; the Storage rules and `submitPass` check exactly this. */
export const evidencePath = (
  tenantId: string,
  vehicleId: string,
  dateKey: string,
  attempt: number,
  file: EvidenceFileName,
): string => `tenants/${tenantId}/passes/${vehicleId}/${dateKey}/${attempt}/${file}`

/** `passes/{vehicleId}_{dateKey}` (one pass per vehicle per day). */
export const passDocId = (vehicleId: string, dateKey: string): string => `${vehicleId}_${dateKey}`
