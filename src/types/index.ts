import type { Timestamp } from 'firebase/firestore'
import type { Role } from '@/lib/roles'
import type { ChecklistItemDef, PassSettings } from '@/lib/defaultChecklist'
import type { RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import type { GateDef } from '@/lib/gates'
import type { SlaSettings } from '@/lib/defaultSla'
import type { EligibilityStatus } from '@/lib/expiry'
import type { VehicleClearance } from './inspections'
import type { PermitRecord, QualificationRecords, QualificationTypeDef } from '@/lib/requirementLogic'

export type UserStatus = 'active' | 'disabled'
export type ContractorStatus = 'active' | 'suspended'

export interface Tenant {
  name: string
  status: 'active' | 'suspended'
  createdAt: Timestamp
  /** IANA name. Defaults to Asia/Colombo when absent. Function-written. */
  timezone?: string
  passSettings?: Partial<PassSettings>
  /** Falls back to DEFAULT_CHECKLIST when absent or empty. */
  checklist?: ChecklistItemDef[]
  /** Falls back to DEFAULT_REJECTION_REASONS when absent or empty. */
  rejectionReasons?: RejectionReasonDef[]
  /** Falls back to DEFAULT_GATES when absent or empty. */
  gates?: GateDef[]
  /** Falls back to DEFAULT_SLA. */
  sla?: Partial<SlaSettings>
  /** 0 or absent = keep evidence forever; otherwise 30-3650 days. */
  retentionDays?: number
  /** Allowed vehicle types (names). Falls back to the defaults when absent or empty. */
  vehicleTypes?: string[]
  /** Days before an expiry date when a record turns "expiring soon". Falls back to 14. */
  expiryWarningDays?: number
  /** Hours before a visit still checked in gets a dwell warning (warning only). Absent = 16. */
  dwellLimitHours?: number
  /** Gate passes: issue every qualified pairing's pass at month rollover. Absent or false = the admin chooses from the month-end list. */
  autoIssueGatePasses?: boolean
  /** Qualifications every driver must hold (valid one year each). Falls back to the defaults when absent. */
  qualificationTypes?: QualificationTypeDef[]
}

export interface UserDoc {
  tenantId: string
  role: Role
  contractorId: string | null
  name: string
  email: string | null
  phone: string | null
  status: UserStatus
  mustChangePassword: boolean
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  /** Module 12: `pin` for drivers and security, `password` for office staff. Absent on accounts that predate it. */
  loginType?: 'pin' | 'password'
  /** PIN users: last successful PIN sign-in (function-written). */
  lastLoginAt?: Timestamp
  /** PIN users: up to 5 devices, keyed by a hash of the device id (function-written). */
  knownDevices?: Record<string, { firstSeenAt: Timestamp; lastSeenAt: Timestamp }>
  /** PIN users: seconds. Sessions that signed in before this were ended by a reissued PIN. */
  sessionsRevokedAt?: number
}

export interface Contractor {
  tenantId: string
  name: string
  contactName?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  /** Function-only (setContractorStatus). */
  status: ContractorStatus
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

export type VehicleStatus = 'active' | 'suspended'

/** `vehicles/{vehicleId}`: the document id is the permanent QR id (`veh_` + 10 chars). */
export interface Vehicle {
  tenantId: string
  contractorId: string
  plateNo: string
  plateKey: string
  type: string
  makeModel?: string
  assignedDriverIds: string[]
  status: VehicleStatus
  /** `YYYY-MM-DD`. Absent = not tracked. */
  insuranceExpiry?: string
  registrationExpiry?: string
  /** The annual inspection is valid through this day. Required for assignment, gate passes and check-in; absent = never inspected. */
  annualInspectionExpiry?: string
  /** Denormalised by the callables and the daily job; absent on records that predate expiry tracking. */
  eligibilityStatus?: EligibilityStatus
  /** Copy of the current inspection, written with it by the inspection functions. Absent = never inspected. */
  clearance?: VehicleClearance
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

/** `drivers/{uid}`: same id as the Auth uid and the `users` doc. */
export interface Driver {
  tenantId: string
  contractorId: string
  name: string
  /** Contact number only (Module 12): optional, never a login. */
  phone: string | null
  licenseNo?: string | null
  /** `YYYY-MM-DD`. Absent or null = not tracked. */
  licenseExpiry?: string | null
  eligibilityStatus?: EligibilityStatus
  photoPath?: string | null
  /** Recorded by the Admin or Officer, by qualification type id (function-written). */
  qualifications?: QualificationRecords
  /** The driver's own permit numbers, 0-2 (function-written). Information only. */
  permits?: PermitRecord[]
  status: UserStatus
  /** True while the driver is on a visit (check-in to check-out). Written only by the visit functions. */
  driverOnDutyLock?: boolean
  activeVisitId?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type WithId<T> = T & { id: string }

/** Custom claims, read from the ID token. Only Cloud Functions ever set these. */
export interface Claims {
  role: Role
  tenantId: string
  contractorId: string | null
}
