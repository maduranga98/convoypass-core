import type { SlaSettings } from './defaultSla.js'
import type { EligibilityStatus } from './expiry.js'
import type { GateDef } from './gates.js'
import type { ClearanceStatus, InspectionResult, InspectionStatus, InvalidationReason } from './inspectionLogic.js'
import type { PermitRecord, QualificationRecords, QualificationTypeDef } from './requirementLogic.js'
import type { PenaltyDurationMs, PenaltyStatus, PenaltyTarget } from './penaltyLogic.js'

export const ROLES = ['admin', 'officer', 'supervisor', 'safety', 'driver', 'security', 'yard'] as const
export type Role = (typeof ROLES)[number]

export type { GateDef }

export type UserStatus = 'active' | 'disabled'

export interface Caller {
  uid: string
  role: Role
  tenantId: string
  contractorId: string | null
  /** Seconds since epoch of the caller's last sign-in (token `auth_time`). */
  authTime: number
}

export interface UserData {
  tenantId: string
  role: Role
  contractorId: string | null
  name: string
  email: string | null
  phone: string | null
  status: UserStatus
  mustChangePassword: boolean
  /** Module 12: `pin` for drivers and security (no email, no password on the Auth user), `password` for everyone else. Absent on accounts that predate it. */
  loginType?: LoginType
  /** PIN users: incremented by every reissue (keys the "new device" notification so a reissue can alert again). */
  pinVersion?: number
  /** PIN users: seconds. A session that signed in before this (token `auth_time`) is refused (`session-expired`). */
  sessionsRevokedAt?: number
}

export type LoginType = 'pin' | 'password'

/** `pinIndex/{hmacHex}`: the only place a PIN exists, as an HMAC under PIN_PEPPER. Server only (rules deny everyone). */
export interface PinIndexEntry {
  uid: string
  tenantId: string
  role: 'driver' | 'security' | 'yard'
}

export type ContractorStatus = 'active' | 'suspended'
export type VehicleStatus = 'active' | 'suspended'

export interface ContractorData {
  tenantId: string
  status: ContractorStatus
}

export interface VehicleData {
  tenantId: string
  contractorId: string
  plateNo: string
  plateKey: string
  type: string
  makeModel?: string
  assignedDriverIds: string[]
  status: VehicleStatus
  /** `YYYY-MM-DD`. Absent on vehicles that predate expiry tracking (= not tracked). */
  insuranceExpiry?: string
  registrationExpiry?: string
  /** `YYYY-MM-DD`: the annual inspection is valid through this day. Required to be assigned, issued a gate pass and checked in (absent = never inspected). */
  annualInspectionExpiry?: string
  /** Denormalised from the two dates, the tenant's warning window and today. Written by the callables and the daily job. */
  eligibilityStatus?: EligibilityStatus
  /** Denormalised from the current inspection by the inspection functions (one transaction with it). Absent = never inspected. */
  clearance?: VehicleClearance
}

/** The vehicle's current inspection in a few fields, so lists and the gate read one document. `at` is milliseconds. */
export interface VehicleClearance {
  status: Exclude<ClearanceStatus, 'never_inspected'>
  inspectionId: string
  reason: InvalidationReason | null
  at: number
}

/** `null` removes the field. */
export type VehiclePatch = Partial<
  Omit<VehicleData, 'tenantId' | 'contractorId' | 'plateKey' | 'makeModel' | 'insuranceExpiry' | 'registrationExpiry' | 'annualInspectionExpiry'>
> & {
  makeModel?: string | null
  insuranceExpiry?: string | null
  registrationExpiry?: string | null
  annualInspectionExpiry?: string | null
}

/** `drivers/{uid}`: same id as the `users` doc. name, phone and status mirror `users`. */
export interface DriverData {
  tenantId: string
  contractorId: string
  name: string
  /** Contact number only (Module 12): optional, not unique, never a login. */
  phone: string | null
  licenseNo?: string | null
  /** `YYYY-MM-DD`. Absent = not tracked. */
  licenseExpiry?: string | null
  /** Denormalised from `licenseExpiry` (callables and the daily job). */
  eligibilityStatus?: EligibilityStatus
  photoPath?: string | null
  /** Qualifications recorded by the Admin or Officer, by qualification type id. Written only by `recordQualification`. */
  qualifications?: QualificationRecords
  /** The driver's own permit numbers (0-2). Information only; written only by `setMyPermits`. */
  permits?: PermitRecord[]
  status: UserStatus
  /** Visit lifecycle: true from a visit's check-in until its check-out. Written ONLY by the visit transactions (never by `updateUser`). Absent = false. */
  driverOnDutyLock?: boolean
  /** The visit that holds the lock; null/absent when free. */
  activeVisitId?: string | null
}

export interface AuditEntry {
  tenantId: string
  action: string
  actorUid: string
  /** `system` for scheduled jobs (retention); `superadmin` for the platform super admin (Module 10). */
  actorRole: Role | 'system' | 'superadmin'
  /** Display name of a non-tenant actor (`ConvoyPass Super Admin`): the tenant's admins cannot read `operators`. */
  actorName?: string
  targetType: 'user' | 'vehicle' | 'contractor' | 'tenant' | 'pass' | 'gateEvent' | 'notification' | 'penalty' | 'penaltyType' | 'inspection' | 'visit' | 'gatePass' | 'qualification'
  targetId: string
  meta: Record<string, string | number | boolean | null>
}

export interface Claims {
  role: Role
  tenantId: string
  contractorId?: string
}

// ---- Module 3: passes ------------------------------------------------------------------------

export type PassStatus = 'submitted' | 'supervisor_approved' | 'officer_approved' | 'checked_in' | 'rejected'

export interface ChecklistItemDef {
  id: string
  label: string
  failBlocks: boolean
}

export interface PassSettings {
  requireLocation: boolean
  maxExtraPhotos: number
}

export interface RejectionReasonDef {
  id: string
  label: string
}

/** `tenants/{tenantId}`: only the fields functions read or write. Every field is optional on older tenants. */
export interface TenantData {
  timezone?: string
  passSettings?: Partial<PassSettings>
  checklist?: ChecklistItemDef[]
  /** Falls back to DEFAULT_REJECTION_REASONS when absent or empty. */
  rejectionReasons?: RejectionReasonDef[]
  /** Falls back to DEFAULT_GATES when absent or empty. */
  gates?: GateDef[]
  /** Falls back to DEFAULT_SLA. */
  sla?: Partial<SlaSettings>
  /** Evidence retention in days. 0 or absent = keep forever; otherwise 30-3650. */
  retentionDays?: number
  /** Allowed vehicle types (names). Falls back to the default list when absent or empty. */
  vehicleTypes?: string[]
  /** Days before an expiry date when a record turns "expiring soon". Falls back to 14. */
  expiryWarningDays?: number
  /** Hours a visit may stay checked in before it is flagged `dwellWarning` (warning only, nothing is blocked). Falls back to 16. */
  dwellLimitHours?: number
  /** Qualifications every driver must hold (one year each). Falls back to the defaults when never saved. */
  qualificationTypes?: QualificationTypeDef[]
  /** Gate passes: issue the month's pass to every qualified pairing at month rollover (default off = the Company Admin selects). */
  autoIssueGatePasses?: boolean
  /** The month (`YYYY-MM`) whose rollover (expiry, optional auto-issue) already ran. */
  gatePassRolloverMonth?: string
}


export interface EvidenceFile {
  path: string
  size: number
  contentType: string
}

export interface PassChecklistItem {
  id: string
  label: string
  answer: 'yes' | 'no'
  note?: string
}

export interface Evidence {
  gps: EvidenceFile
  dashcam: EvidenceFile
  extra: EvidenceFile[]
}

export interface CaptureMeta {
  method: 'live' | 'file'
  clientCapturedAt: { gps: string; dashcam: string }
  location?: { lat: number; lng: number; accuracy: number }
}

export type DecisionStage = 'supervisor' | 'officer' | 'revoked'

/** Written by `decidePass` / `revokePass` when a pass is rejected. */
export interface Rejection {
  /** Human readable: the reason label plus the note (the Module 3 resubmit screen shows exactly this). */
  reason: string
  reasonCode: string
  note?: string
  stage: DecisionStage
  byUid: string
  byName: string
  byRole: Role
  /** Milliseconds since epoch (converted from a Timestamp by the data port). */
  at: number
}

/** Who approved at a step. */
export interface ApprovalStamp {
  uid: string
  name: string
  /** Milliseconds since epoch. */
  at: number
}

/** Appended on every decision (and the gate check-in) and never removed, not even on resubmit. */
export interface HistoryEntry {
  action: 'approve' | 'reject' | 'revoke' | 'check_in'
  stage: DecisionStage | 'gate'
  byUid: string
  byName: string
  byRole: Role
  /** Milliseconds since epoch. */
  at: number
  attempt: number
}

/** Kept when a rejected pass is resubmitted, with what that attempt looked like. */
export interface RejectionHistoryEntry extends Rejection {
  attempt: number
  checklist: PassChecklistItem[]
  evidence: Evidence
}

/** `passes/{vehicleId}_{dateKey}`. Timestamps are milliseconds here; the data port converts. */
export interface PassData {
  tenantId: string
  contractorId: string
  vehicleId: string
  plateNo: string
  vehicleType: string
  dateKey: string
  driverId: string
  driverName: string
  status: PassStatus
  attempt: number
  submittedAt: number | null
  checklist: PassChecklistItem[]
  evidence: Evidence
  captureMeta: CaptureMeta
  supervisor?: ApprovalStamp
  officer?: ApprovalStamp
  rejection?: Rejection
  rejectionHistory?: RejectionHistoryEntry[]
  history?: HistoryEntry[]
  /** Set once by `checkIn`. There is no check-out. */
  checkIn?: CheckInStamp
  /** Written by the SLA reminder job: which attempt was already reminded for each step (one reminder per step and attempt). */
  slaAlerts?: SlaAlerts
  /** Set by `purgeOldEvidence` (milliseconds here): the photos are gone, the pass and its history stay. */
  evidenceDeletedAt?: number
}

export type SlaStage = 'supervisor' | 'officer'
export type SlaAlerts = Partial<Record<SlaStage, { attempt: number; at: number }>>

/** Who let the vehicle in, where and when. `at` is the server time (milliseconds here; the data port converts). */
export interface CheckInStamp {
  uid: string
  name: string
  at: number
  gateId: string
  gateName: string
  /** Client UUID that makes the call idempotent (retries and the offline queue rely on it). */
  requestId: string
  /** Device time of an offline check-in, ISO string. Bounded on the server but never trusted: shown as unverified. */
  offlineCapturedAt?: string
}

/** `gateEvents/den_{requestId}`: a vehicle turned away at the gate. Never changes the pass. */
export interface GateEventData {
  tenantId: string
  type: 'denied'
  vehicleId: string
  plateNo: string
  contractorId: string
  /** Today's pass for the vehicle, when there is one. */
  passId: string | null
  /** Its status at the moment of the denial, read by the server. */
  passStatus: PassStatus | null
  /** The driver named on that pass, for the gate log. */
  driverName: string | null
  dateKey: string
  reasonCode: string
  note?: string
  gateId: string
  gateName: string
  byUid: string
  byName: string
  /** Milliseconds since epoch (server time). */
  at: number
  requestId: string
}

/** What `submitPass` hands the data port; the port adds status, timestamps and history. */
export type PassWrite = Omit<
  PassData,
  'status' | 'submittedAt' | 'supervisor' | 'officer' | 'rejection' | 'rejectionHistory' | 'history' | 'checkIn'
>

/** Object metadata read from Storage with the Admin SDK. */
export interface StoredFile {
  contentType: string
  size: number
  /** Milliseconds since epoch. */
  timeCreated: number
  /** First bytes of the object. */
  head: Uint8Array
}

// ---- Penalties and suspensions ---------------------------------------------------------------

export type { PenaltyStatus, PenaltyTarget }

/** `penaltyTypes/{id}`: a per-company, admin-managed list. There is no seeded list. */
export interface PenaltyTypeData {
  tenantId: string
  name: string
  /** Lower-cased, single-spaced name: uniqueness is checked on this. */
  nameKey: string
  createdBy: string
}

export interface PenaltyVerification {
  verifiedBy: string | null
  verifiedByName: string | null
  /** Milliseconds since epoch (the data port converts). */
  verifiedAt: number | null
  verificationNote: string | null
}

/** `penalties/{id}`. Timestamps are milliseconds here; the data port converts. */
export interface PenaltyData {
  tenantId: string
  /** The contractor both targets belong to (a penalty on a driver and a vehicle needs them to match). */
  contractorId: string
  target: PenaltyTarget
  /** Names at issue time, so history reads without joins and survives later renames. */
  targetLabels: { driverName: string | null; plateNo: string | null }
  typeId: string
  typeName: string
  duration: PenaltyDurationMs
  issuedBy: { uid: string; name: string; role: 'admin' | 'safety' }
  issuedAt: number
  reason: string
  /** Storage path (never a URL): `tenants/{tenantId}/penalties/{penaltyId}/evidence.jpg`. */
  evidencePhotoPath: string | null
  status: PenaltyStatus
  /** Set when an admin revokes. */
  revocation?: { byUid: string; byName: string; at: number; note: string }
  /** Set by the scheduled job when a fixed penalty ends. */
  expiredAt?: number
  verification: PenaltyVerification
}

// ---- Inspections -----------------------------------------------------------------------------

export type { ClearanceStatus, InspectionResult, InspectionStatus, InvalidationReason }

/** `inspections/{id}`. Timestamps are milliseconds here; the data port converts. A record is never edited, only superseded or invalidated. */
export interface InspectionData {
  tenantId: string
  vehicleId: string
  contractorId: string
  /** Plate at inspection time, so history reads without joins. */
  plateNo: string
  inspectedBy: { uid: string; name: string }
  inspectedAt: number
  result: InspectionResult
  notes: string
  status: InspectionStatus
  invalidatedReason: InvalidationReason | null
  invalidatedAt: number | null
  /** What cancelled it: a penalty id, `vehicle`, `driver:<uid>` or the officer's uid (manual). Never a name. */
  invalidationSource?: string | null
  /** The Safety Officer's reason for a manual withdrawal (`invalidatedReason: 'manual'`). */
  invalidationNote?: string | null
  /** The newer inspection that replaced this one. */
  supersededBy?: string | null
}

// ---- Visit lifecycle -------------------------------------------------------------------------

/**
 * `visits/{vis_…}`: one vehicle visit with three timestamped stages. Times are milliseconds here (stored as Timestamps).
 * Plate and driver name are copied at check-in so the Yard Officer and the gate lists need no other collection.
 * Only callables write it (clients read, rules); `status` is derived from `checkOut` and written with it.
 */
export interface VisitData {
  tenantId: string
  vehicleId: string
  /** The daily pass (`{vehicleId}_{dateKey}`) this movement belongs to. Absent on visits that predate multiple entries per day. */
  passId?: string
  driverId: string
  contractorId: string
  plateNo: string
  driverName: string
  checkIn: {
    timestamp: number
    /** `YYYYMMDD` in the tenant timezone (counts per day). */
    dateKey: string
    securityUserId: string
    securityUserName: string
    gateId: string | null
    /** Name of the gate (optional). */
    gateLocation: string | null
    requestId: string
  }
  /** null until the Yard Officer logs it; re-logging replaces it (every change is audited). */
  unloadingCheck: {
    performed: true
    timestamp: number
    dateKey: string
    officerUserId: string
    officerName: string
    unloaded: boolean
    unloadLocation: string | null
  } | null
  /** null until the vehicle leaves. */
  checkOut: {
    timestamp: number
    dateKey: string
    securityUserId: string
    securityUserName: string
    requestId: string
  } | null
  status: 'checked_in' | 'checked_out'
  /** True from check-in until check-out: mirrors `drivers/{driverId}.driverOnDutyLock`. */
  driverOnDutyLock: boolean
  /** Set by the scheduled job once the visit has stayed checked in for the company's dwell limit. A warning only. */
  dwellWarning: boolean
  dwellWarningAt?: number | null
}
