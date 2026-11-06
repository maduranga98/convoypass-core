import { httpsCallable } from 'firebase/functions'
import type { Role } from './roles'
import { functions } from './firebase'
import { isSessionExpired, reportSessionExpired } from './sessionEvents'
import type { ChecklistItemDef, PassSettings } from './defaultChecklist'
import type { RejectionReasonDef } from './defaultRejectionReasons'
import type { GateDef } from './gates'
import type { ClearanceStatus } from '@/lib/inspectionLogic'
import type { RecordInspectionPayload } from '@/types/inspections'
import type { CheckInVisitPayload, CheckInVisitResult, CheckOutVisitPayload, CheckOutVisitResult, DailySummary, UnloadingCheckPayload } from '@/types/visits'
import type { EligibilityResult, IssuePenaltyPayload } from '@/types/penalties'
import type { IssueGatePassesPayload, IssueGatePassesResult, QualificationMetaResult } from '@/types/gatePasses'
import type { ReportRequest, ReportResult, TrendResult } from '@/types/reports'
import type { SlaSettings } from './defaultSla'
import type { CreatedInvite, InviteRow, InviteStatus, OperatorOverview, TenantRow, WorkspaceCredentials, WorkspaceDetail } from '@/types/platform'
import type {
  BulkItemResult,
  CheckInPayload,
  CheckInResult,
  DecidePassPayload,
  DenyEntryPayload,
  PassStatus,
  ResolveResult,
  SubmitPassPayload,
} from '@/types/passes'

export interface CreateUserPayload {
  role: Role
  name: string
  email?: string
  phone?: string
  contractorId?: string
  licenseNo?: string
  /** Drivers only. `YYYY-MM-DD`. */
  licenseExpiry?: string
  /** Office staff only. Drivers and security get a server-generated PIN (Module 12). */
  password?: string
}

export interface UpdateUserPayload {
  uid: string
  name?: string
  /** Drivers and security: contact number only. `null` clears it. */
  phone?: string | null
  status?: 'active' | 'disabled'
  /** Drivers only. `null` clears it. */
  licenseNo?: string | null
  /** Drivers only. `YYYY-MM-DD`; `null` clears it. */
  licenseExpiry?: string | null
  /** Drivers only: `tenants/{tenantId}/contractors/{contractorId}/drivers/{uid}.jpg`. */
  photoPath?: string
}

const call = <Req, Res>(name: string, timeout?: number) => {
  const fn = httpsCallable<Req, Res>(functions, name, timeout ? { timeout } : undefined)
  return async (payload: Req): Promise<Res> => {
    try {
      return (await fn(payload)).data
    } catch (e) {
      // A PIN session past its limit (or from before a reissued PIN): sign out and ask for the PIN again.
      if (isSessionExpired(e)) reportSessionExpired()
      throw e
    }
  }
}

/** `pin` is set for drivers and security (Module 12) and appears in this one response only: show it once, never store it. */
export const createUser = call<CreateUserPayload, { uid: string; pin?: string }>('createUser')
export const reissuePin = call<{ uid: string }, { pin: string }>('reissuePin', 30_000)
export const revealPin = call<{ uid: string }, { pin: string }>('revealPin', 30_000)
/** Unauthenticated. Every failure is one error (`pin-invalid`), with `retryAfterSeconds` while this IP or device is locked. */
export const loginWithPin = call<{ pin: string; deviceId: string }, { token: string }>('loginWithPin', 30_000)
export const updateUser = call<UpdateUserPayload, { ok: true }>('updateUser')
export const resetCredential = call<{ uid: string; newPassword: string }, { ok: true }>('resetCredential')
export const changeOwnPassword = call<{ newPassword: string }, { ok: true }>('changeOwnPassword')

export interface VehicleInput {
  plateNo: string
  /** A name from the tenant's vehicle types. */
  type: string
  makeModel?: string
  /** `YYYY-MM-DD`; on update `null` clears the date. */
  insuranceExpiry?: string | null
  registrationExpiry?: string | null
  annualInspectionExpiry?: string | null
}

export type ImportRowError = 'invalid-plate' | 'invalid-type' | 'invalid-make-model' | 'plate-exists' | 'internal'
export interface ImportRowResult {
  /** 1-based position in the rows that were sent. */
  row: number
  ok: boolean
  vehicleId?: string
  error?: ImportRowError
}

export const createVehicle = call<
  Omit<VehicleInput, 'insuranceExpiry' | 'registrationExpiry' | 'annualInspectionExpiry'> & {
    contractorId?: string
    driverIds?: string[]
    insuranceExpiry?: string
    registrationExpiry?: string
    annualInspectionExpiry?: string
  },
  { vehicleId: string; plateNo: string }
>('createVehicle')
export const updateVehicle = call<Partial<VehicleInput> & { vehicleId: string }, { ok: true }>('updateVehicle')
export const setVehicleStatus = call<{ vehicleId: string; status: 'active' | 'suspended' }, { ok: true }>('setVehicleStatus')
export const setVehicleDrivers = call<{ vehicleId: string; driverIds: string[] }, { ok: true }>('setVehicleDrivers')
export const importVehicles = call<
  { contractorId?: string; rows: Pick<VehicleInput, 'plateNo' | 'type' | 'makeModel'>[] },
  { results: ImportRowResult[]; created: number }
>('importVehicles', 180_000)
export const setContractorStatus = call<
  { contractorId: string; status: 'active' | 'suspended' },
  { ok: true; revoked: number }
>('setContractorStatus', 120_000)

export const resolveVehicle = call<{ vehicleId: string }, ResolveResult>('resolveVehicle', 30_000)
export const submitPass = call<SubmitPassPayload, { passId: string; status: 'submitted'; attempt: number }>(
  'submitPass',
  60_000,
)
export const updateTenantSettings = call<
  { passSettings?: PassSettings; checklist?: ChecklistItemDef[]; rejectionReasons?: RejectionReasonDef[]; gates?: GateDef[]; sla?: SlaSettings; retentionDays?: number; vehicleTypes?: string[]; expiryWarningDays?: number; dwellLimitHours?: number; autoIssueGatePasses?: boolean; qualificationTypes?: { id: string; name: string }[] },
  { ok: true }
>('updateTenantSettings')

/** Admin or Officer: the driver completed this training on `completedOn` (`YYYY-MM-DD`); the server adds the year. */
export const recordQualification = call<{ driverId: string; typeId: string; completedOn: string }, { expiresOn: string }>('recordQualification')
/** Driver: replaces their own permit numbers (0-2). Information only. */
export const setMyPermits = call<{ permits: string[] }, { permits: { number: string; enteredOn: string; expiresOn: string }[] }>('setMyPermits')

// Module 4: approvals. The client says what it was looking at (expectedStatus/Attempt); the server decides.
export const decidePass = call<DecidePassPayload, { passId: string; status: PassStatus; attempt: number }>(
  'decidePass',
  30_000,
)
export const bulkApprove = call<{ items: { passId: string; expectedAttempt: number }[] }, { results: BulkItemResult[] }>(
  'bulkApprove',
  120_000,
)
export const revokePass = call<
  { passId: string; reasonCode: string; note?: string; expectedAttempt?: number },
  { passId: string; status: 'rejected' }
>('revokePass', 30_000)

// Module 5: the gate. Reads go straight to Firestore; these are the only writes. Both are idempotent per requestId.
export const checkIn = call<CheckInPayload, CheckInResult>('checkIn', 20_000)
export const denyEntry = call<DenyEntryPayload, { eventId: string; at: number; passStatus: PassStatus | null }>('denyEntry', 20_000)

// Module 6: dashboard trend and reports (admin and officer; read only). Reports can scan a lot of passes, so wait longer.
export const getDashboardTrend = call<{ days: 7 | 14 | 30 }, TrendResult>('getDashboardTrend', 60_000)
export const runReport = call<ReportRequest, ReportResult>('runReport', 300_000)

// Module 7: push devices (caller only). The browser's FCM token goes to the server, never into the page's storage.
export const registerDevice = call<{ deviceId: string; token: string; platform: 'android' | 'ios' | 'desktop' | 'other' }, { ok: true }>(
  'registerDevice',
  20_000,
)
export const unregisterDevice = call<{ deviceId: string }, { ok: true }>('unregisterDevice', 20_000)

// Crash reports (signed-in users only; the server scrubs, truncates and rate limits).
export const reportClientError = call<
  { message: string; stack?: string; route?: string; source: 'boundary' | 'window' | 'promise' | 'gate' | 'form'; appVersion?: string },
  { ok: true }
>('reportClientError', 10_000)

// Module 8: invite-only workspace setup. Both are callable without signing in (the server rate limits per IP).
export const validateSetupInvite = call<{ code: string }, { valid: boolean; companyHint?: string; emailLock?: string }>('validateSetupInvite', 20_000)
export const completeSetup = call<
  { code: string; companyName: string; adminName: string; email: string; password: string; timezone: string },
  { tenantId: string }
>('completeSetup', 60_000)

// Module 11: open super admin signup (public; the server switch SUPERADMIN_SIGNUP_ENABLED decides, per-IP rate limits).
export const getSuperAdminSignupStatus = call<Record<string, never>, { enabled: boolean }>('getSuperAdminSignupStatus', 15_000)
export const signUpSuperAdmin = call<{ name: string; email: string; password: string }, { ok: true }>('signUpSuperAdmin', 60_000)

// Module 9: platform operator console. Operators only (claims { role: 'platform', platformAdmin: true }, no tenant).
// `createSetupInvite` returns the invite code ONCE: the page holds it in component state only (never a query cache).
export const getOperatorProfile = call<Record<string, never>, { name: string; email: string; mustChangePassword: boolean }>('getOperatorProfile', 20_000)
export const getOperatorOverview = call<Record<string, never>, OperatorOverview>('getOperatorOverview', 20_000)
export const createSetupInvite = call<{ companyHint?: string; lockEmail?: string; expiresInDays: number }, CreatedInvite>('createSetupInvite', 30_000)
export const listSetupInvites = call<{ status?: InviteStatus; cursor?: string }, { invites: InviteRow[]; nextCursor: string | null }>('listSetupInvites', 30_000)
export const revokeSetupInvite = call<{ hashPrefix: string }, { ok: true }>('revokeSetupInvite', 30_000)
export const listTenants = call<{ cursor?: string }, { tenants: TenantRow[]; nextCursor: string | null }>('listTenants', 30_000)

// Module 10: super admin creates workspaces and manages their admins. The temporary password is in these responses only.
export const createWorkspace = call<{ companyName: string; timezone: string; adminName: string; adminEmail: string }, WorkspaceCredentials>('createWorkspace', 60_000)
export const addTenantAdmin = call<{ tenantId: string; name: string; email: string }, WorkspaceCredentials>('addTenantAdmin', 60_000)
export const resetTenantAdminCredential = call<{ tenantId: string; uid: string }, WorkspaceCredentials>('resetTenantAdminCredential', 60_000)
export const setTenantAdminStatus = call<{ tenantId: string; uid: string; status: 'active' | 'disabled' }, { ok: true }>('setTenantAdminStatus', 30_000)
export const updateTenantAdmin = call<{ tenantId: string; uid: string; name: string }, { ok: true }>('updateTenantAdmin', 30_000)
export const getWorkspace = call<{ tenantId: string }, WorkspaceDetail>('getWorkspace', 30_000)

// ---- Penalties and suspensions ------------------------------------------------------------------

export const createPenaltyType = call<{ name: string }, { typeId: string }>('createPenaltyType')
export const updatePenaltyType = call<{ typeId: string; name: string }, { ok: true }>('updatePenaltyType')
export const deletePenaltyType = call<{ typeId: string }, { ok: true }>('deletePenaltyType')
/** Admin or Safety Officer. The penalty is in force the moment this returns. A retry with the same `penaltyId` is safe. */
export const issuePenalty = call<IssuePenaltyPayload, { penaltyId: string; created: boolean }>('issuePenalty', 60_000)
/** Admin only. */
export const revokePenalty = call<{ penaltyId: string; note: string }, { ok: true }>('revokePenalty')
/** Supervisor, own contractor: confirms the penalty was reviewed. It does not change whether the penalty applies. */
export const verifyPenalty = call<{ penaltyId: string; note?: string }, { ok: true }>('verifyPenalty')
/** The live check shared by the gate and trip assignment: documents + active penalties. */
export const checkEligibility = call<{ vehicleId?: string; driverId?: string }, EligibilityResult>('checkEligibility')
/** Safety Officer only. An approval clears the vehicle for every trip until a penalty or an expired document cancels it. A retry with the same `inspectionId` is safe. */
// Monthly gate passes. Reads go straight to Firestore (rules); these are the only writes. The Company Admin only.
export const issueGatePasses = call<IssueGatePassesPayload, IssueGatePassesResult>('issueGatePasses', 120_000)
export const blockGatePass = call<{ passId: string; note: string }, { ok: true }>('blockGatePass', 30_000)
export const reactivateGatePass = call<{ passId: string }, { ok: true }>('reactivateGatePass', 30_000)
export const refreshQualificationList = call<{ month: string }, QualificationMetaResult>('refreshQualificationList', 300_000)
export const recordInspection = call<RecordInspectionPayload, { inspectionId: string; created: boolean; clearance: ClearanceStatus }>('recordInspection')
/** Safety Officer only: cancels the vehicle's current approval without a new inspection. */
export const withdrawClearance = call<{ vehicleId: string; note: string }, { ok: true }>('withdrawClearance')

// Visit lifecycle. Check-in carries the driver's PIN, so it is never retried by the app on its own; the visit id makes a
// manual retry safe.
export const checkInVisit = call<CheckInVisitPayload, CheckInVisitResult>('checkInVisit')
export const checkOutVisit = call<CheckOutVisitPayload, CheckOutVisitResult>('checkOutVisit')
export const logUnloadingCheck = call<UnloadingCheckPayload, { visitId: string; at: number }>('logUnloadingCheck')
export const getDailySummary = call<Record<string, never>, DailySummary>('getDailySummary')
