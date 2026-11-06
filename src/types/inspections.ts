import type { Timestamp } from 'firebase/firestore'
import type { ClearanceStatus, InspectionResult, InspectionStatus, InvalidationReason } from '@/lib/inspectionLogic'

/** `inspections/{id}`. Function-written; clients only read. A record is never edited, only superseded or cancelled. */
export interface Inspection {
  tenantId: string
  vehicleId: string
  contractorId: string
  /** Plate at inspection time. */
  plateNo: string
  inspectedBy: { uid: string; name: string }
  inspectedAt: Timestamp
  result: InspectionResult
  notes: string
  status: InspectionStatus
  invalidatedReason: InvalidationReason | null
  invalidatedAt: Timestamp | null
  /** The Safety Officer's reason for a manual withdrawal. */
  invalidationNote?: string | null
  supersededBy?: string | null
  createdAt: Timestamp
}

/** The copy of the current inspection kept on the vehicle (milliseconds). Absent = never inspected. */
export interface VehicleClearance {
  status: Exclude<ClearanceStatus, 'never_inspected'>
  inspectionId: string
  reason: InvalidationReason | null
  at: number
}

export interface RecordInspectionPayload {
  /** `insp_` + 10 chars chosen by the browser: a retry of the same call is safe. */
  inspectionId: string
  vehicleId: string
  result: InspectionResult
  notes: string
}
