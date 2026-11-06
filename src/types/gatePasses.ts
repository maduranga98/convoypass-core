import type { Timestamp } from 'firebase/firestore'
import type { BlockReason, GatePassStatus } from '@/lib/gatePassLogic'

/** `gatePasses/{month}_{vehicleId}_{driverId}`. Function-written; clients only read. */
export interface GatePass {
  tenantId: string
  vehicleId: string
  driverId: string
  contractorId: string
  plateNo: string
  driverName: string
  /** `YYYY-MM` in the company timezone. */
  month: string
  status: GatePassStatus
  issuedAt: Timestamp
  /** `system` for an automatic issue. */
  issuedBy: { uid: string; name: string }
  issueMode: 'manual' | 'auto'
  blockedReason: BlockReason | null
  blockedAt: Timestamp | null
  blockNote: string | null
  reactivation: { by: { uid: string; name: string }; at: Timestamp; previousReason: BlockReason | null } | null
  expiredAt: Timestamp | null
}

/** `monthEndQualification/{tenantId}_{month}`: the summary of the last computation. */
export interface QualificationMeta {
  tenantId: string
  month: string
  computedAt: Timestamp
  trigger: 'schedule' | 'manual' | 'auto'
  evaluatedCount: number
  qualifiedCount: number
  alreadyIssuedCount: number
  notEligibleCount: number
  failedCount: number
  truncated: boolean
}

/** `monthEndQualification/{id}/entries/{vehicleId}_{driverId}`. */
export interface QualificationEntry {
  tenantId: string
  month: string
  vehicleId: string
  driverId: string
  contractorId: string
  contractorName: string
  plateNo: string
  driverName: string
  documentStatus: 'valid' | 'expiringSoon'
  computedAt: Timestamp
}

export interface IssueGatePassesPayload {
  month: string
  pairs: { vehicleId: string; driverId: string }[]
}

export interface IssueResultRow {
  vehicleId: string
  driverId: string
  ok: boolean
  passId?: string
  existing?: boolean
  /** An error reason key; shown through `strings.apiErrors`. */
  error?: string
}

export interface IssueGatePassesResult {
  results: IssueResultRow[]
  issued: number
}

/** What `refreshQualificationList` returns (milliseconds, not a Timestamp). */
export interface QualificationMetaResult {
  month: string
  computedAt: number
  evaluatedCount: number
  qualifiedCount: number
  alreadyIssuedCount: number
  notEligibleCount: number
  failedCount: number
  truncated: boolean
}
