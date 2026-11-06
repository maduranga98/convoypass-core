import type { GatePassCheck } from '@/lib/gatePassLogic'
import type { Timestamp } from 'firebase/firestore'
import type { SummaryMetric, VisitStatus } from '@/lib/visitLogic'
import type { EligibilityResult } from '@/types/penalties'

/** `visits/{vis_…}`. Function-written; clients only read. Plate and driver name are copied at check-in. */
export interface Visit {
  tenantId: string
  vehicleId: string
  /** The daily pass this movement belongs to (absent on visits that predate multiple entries per day). */
  passId?: string
  driverId: string
  contractorId: string
  plateNo: string
  driverName: string
  checkIn: {
    timestamp: Timestamp
    dateKey: string
    securityUserId: string
    securityUserName: string
    gateId: string | null
    gateLocation: string | null
    requestId: string
  }
  unloadingCheck: {
    performed: true
    timestamp: Timestamp
    dateKey: string
    officerUserId: string
    officerName: string
    unloaded: boolean
    unloadLocation: string | null
  } | null
  checkOut: {
    timestamp: Timestamp
    dateKey: string
    securityUserId: string
    securityUserName: string
    requestId: string
  } | null
  status: VisitStatus
  driverOnDutyLock: boolean
  dwellWarning: boolean
  dwellWarningAt?: Timestamp | null
}

export interface CheckInVisitPayload {
  /** `vis_` + 10 chars chosen by the browser: a retry of the same call never creates a second visit. */
  visitId: string
  vehicleId: string
  gateId?: string
  requestId: string
}

export type CheckInVisitResult =
  | { outcome: 'checked_in'; visitId: string; at: number; driverName: string; plateNo: string }
  | { outcome: 'blocked'; driverName: string; plateNo: string; eligibility: EligibilityResult }
  /** Eligible, but the pairing has no active monthly gate pass this month. */
  | { outcome: 'no_gate_pass'; driverName: string; plateNo: string; gatePass: Exclude<GatePassCheck, { state: 'active' }> }

export interface CheckOutVisitPayload {
  visitId: string
  requestId: string
}

export interface CheckOutVisitResult {
  visitId: string
  at: number
  unloadingMissing: boolean
}

export interface UnloadingCheckPayload {
  visitId: string
  unloaded: boolean
  unloadLocation?: string | null
}

export interface DwellItem {
  visitId: string
  plateNo: string
  driverName: string
  checkInAt: number
  hours: number
}

export interface DailySummary {
  dateKey: string
  generatedAt: number
  dwellLimitHours: number
  tiles: Partial<Record<SummaryMetric, number>>
  dwell: DwellItem[]
}
