import { z } from 'zod'
import { ROLES } from './types.js'
import { MAX_VEHICLE_TYPES, VEHICLE_TYPE_NAME_MAX, VEHICLE_TYPE_NAME_MIN } from './vehicleTypes.js'
import { isExpiryDate, MAX_EXPIRY_WARNING_DAYS, MIN_EXPIRY_WARNING_DAYS } from './expiry.js'
import { GATE_ID_PATTERN, GATE_NAME_MAX, GATE_NAME_MIN, MAX_GATES, MIN_GATES } from './gates.js'
import { MAX_DENY_NOTE } from './denyReasons.js'
import { SLA_MAX, SLA_MIN } from './defaultSla.js'
import { INSPECTION_ID_PATTERN, PENALTY_ID_PATTERN, VISIT_ID_PATTERN } from './ids.js'
import { MAX_DWELL_LIMIT_HOURS, MIN_DWELL_LIMIT_HOURS, UNLOAD_LOCATION_MAX, UNLOAD_LOCATION_MIN } from './visitLogic.js'
import { isValidMonth, MANUAL_BLOCK_NOTE_MAX, MANUAL_BLOCK_NOTE_MIN } from './gatePassLogic.js'
import { INSPECTION_NOTES_MAX, INSPECTION_RESULTS } from './inspectionLogic.js'
import {
  MAX_PERMITS,
  MAX_QUALIFICATION_TYPES,
  PERMIT_NUMBER_MAX,
  PERMIT_NUMBER_MIN,
  QUALIFICATION_ID_PATTERN,
  QUALIFICATION_NAME_MAX,
  QUALIFICATION_NAME_MIN,
} from './requirementLogic.js'
import { PENALTY_NOTE_MAX, PENALTY_REASON_MAX, PENALTY_REASON_MIN, PENALTY_TYPE_NAME_MAX, PENALTY_TYPE_NAME_MIN } from './penaltyLogic.js'

const name = z.string().trim().min(1).max(100)
/** A calendar date, `YYYY-MM-DD`. */
const expiryDate = z.string().refine(isExpiryDate, 'invalid date')

export const createUserSchema = z.object({
  role: z.enum(ROLES),
  name,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  contractorId: z.string().trim().min(1).max(128).optional(),
  licenseNo: z.string().trim().max(30).optional(),
  licenseExpiry: expiryDate.optional(),
  /** Staff only. Drivers and security get a server-generated PIN (Module 12) and must not send one. */
  password: z.string().min(1).max(128).optional(),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    uid: z.string().min(1).max(128),
    name: name.optional(),
    /** Drivers and security: contact number only. `null` clears it. */
    phone: z.string().trim().max(30).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
    /** Drivers only. `null` clears it. */
    licenseNo: z.string().trim().max(30).nullable().optional(),
    /** Drivers only. `YYYY-MM-DD`; `null` clears it. */
    licenseExpiry: expiryDate.nullable().optional(),
    /** Drivers only. Must equal the canonical Storage path; checked against the target in core. */
    photoPath: z.string().max(300).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.phone !== undefined ||
      v.status !== undefined ||
      v.licenseNo !== undefined ||
      v.licenseExpiry !== undefined ||
      v.photoPath !== undefined,
    { message: 'Nothing to update' },
  )
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const resetCredentialSchema = z.object({
  uid: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
})
export type ResetCredentialInput = z.infer<typeof resetCredentialSchema>

export const reissuePinSchema = z.object({
  uid: z.string().min(1).max(128),
})

export const revealPinSchema = reissuePinSchema

/** Unauthenticated (Module 12). The PIN is normalised (spaces stripped) and checked in `pinLogin.ts`. */
export const loginWithPinSchema = z.object({
  pin: z.string().max(32),
  deviceId: z.uuid(),
})

export const changeOwnPasswordSchema = z.object({
  newPassword: z.string().min(1).max(128),
})
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>

// ---- Module 2: vehicles and contractors ------------------------------------------------------

const id = z.string().trim().min(1).max(128)
export const VEHICLE_ID_PATTERN = /^veh_[a-z0-9]{10}$/
const vehicleId = z.string().regex(VEHICLE_ID_PATTERN)
const plateNo = z.string().max(40)
const makeModel = z.string().trim().max(60)
const driverIds = z.array(id).max(50)
/** Checked against the tenant's own list in the callable. */
const vehicleType = z.string().trim().min(1).max(VEHICLE_TYPE_NAME_MAX)

export const createVehicleSchema = z.object({
  contractorId: id.optional(),
  plateNo,
  type: vehicleType,
  makeModel: makeModel.optional(),
  driverIds: driverIds.optional(),
  insuranceExpiry: expiryDate.optional(),
  registrationExpiry: expiryDate.optional(),
  annualInspectionExpiry: expiryDate.optional(),
})

export const updateVehicleSchema = z
  .object({
    vehicleId,
    plateNo: plateNo.optional(),
    type: vehicleType.optional(),
    makeModel: makeModel.optional(),
    /** `null` clears the date (it is then not tracked). */
    insuranceExpiry: expiryDate.nullable().optional(),
    registrationExpiry: expiryDate.nullable().optional(),
    annualInspectionExpiry: expiryDate.nullable().optional(),
  })
  .refine(
    (v) =>
      v.plateNo !== undefined ||
      v.type !== undefined ||
      v.makeModel !== undefined ||
      v.insuranceExpiry !== undefined ||
      v.registrationExpiry !== undefined ||
      v.annualInspectionExpiry !== undefined,
    { message: 'Nothing to update' },
  )

export const setVehicleStatusSchema = z.object({ vehicleId, status: z.enum(['active', 'suspended']) })
export const setVehicleDriversSchema = z.object({ vehicleId, driverIds })

export const MAX_IMPORT_ROWS = 200
/** Rows are validated one by one in core so a single bad row never fails the batch; this only bounds the shape. */
export const importVehiclesSchema = z.object({
  contractorId: id.optional(),
  rows: z
    .array(z.object({ plateNo: z.string().max(100), type: z.string().max(100), makeModel: z.string().max(200).nullish() }))
    .min(1)
    .max(MAX_IMPORT_ROWS),
})

export const setContractorStatusSchema = z.object({ contractorId: id, status: z.enum(['active', 'suspended']) })

// ---- Module 3: passes ------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5
export const MAX_CHECKLIST_ITEMS = 12
export const CHECKLIST_ID_PATTERN = /^[a-z0-9_]{2,40}$/

export const resolveVehicleSchema = z.object({ vehicleId: z.string().max(128) })

const isoString = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date')

export const submitPassSchema = z.object({
  vehicleId,
  attempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  checklist: z
    .array(
      z.object({
        id: z.string().max(60),
        answer: z.enum(['yes', 'no']),
        note: z.string().max(300).optional(),
      }),
    )
    .max(MAX_CHECKLIST_ITEMS),
  extraCount: z.number().int().min(0).max(2),
  captureMeta: z.object({
    method: z.enum(['live', 'file']),
    clientCapturedAt: z.object({ gps: isoString, dashcam: isoString }),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000),
      })
      .optional(),
  }),
})

export const MAX_BULK_ITEMS = 50
export const REASON_ID_PATTERN = /^[a-z0-9_]{2,40}$/
export const MIN_REJECTION_NOTE = 3
export const MAX_REJECTION_NOTE = 200

const passId = z.string().min(1).max(128)
const reasonCode = z.string().max(40)
const rejectionNote = z.string().trim().max(MAX_REJECTION_NOTE)

export const decidePassSchema = z.object({
  passId,
  action: z.enum(['approve', 'reject']),
  expectedStatus: z.enum(['submitted', 'supervisor_approved', 'officer_approved', 'checked_in', 'rejected']),
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  reasonCode: reasonCode.optional(),
  note: rejectionNote.optional(),
})

export const bulkApproveSchema = z.object({
  items: z
    .array(z.object({ passId, expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS) }))
    .min(1)
    .max(MAX_BULK_ITEMS),
})

export const revokePassSchema = z.object({
  passId,
  reasonCode,
  note: rejectionNote.optional(),
  /** Optional guard: when given, the pass must still be on this attempt. */
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS).optional(),
})

export const updateTenantSettingsSchema = z
  .object({
    passSettings: z
      .object({ requireLocation: z.boolean(), maxExtraPhotos: z.number().int().min(0).max(2) })
      .optional(),
    checklist: z
      .array(
        z.object({
          id: z.string().regex(CHECKLIST_ID_PATTERN),
          label: z.string().trim().min(3).max(60),
          failBlocks: z.boolean(),
        }),
      )
      .min(1)
      .max(MAX_CHECKLIST_ITEMS)
      .optional(),
    rejectionReasons: z
      .array(z.object({ id: z.string().regex(REASON_ID_PATTERN), label: z.string().trim().min(3).max(60) }))
      .min(2)
      .max(10)
      .optional(),
    gates: z
      .array(z.object({ id: z.string().regex(GATE_ID_PATTERN), name: z.string().trim().min(GATE_NAME_MIN).max(GATE_NAME_MAX) }))
      .min(MIN_GATES)
      .max(MAX_GATES)
      .optional(),
    sla: z
      .object({
        supervisorMinutes: z.number().int().min(SLA_MIN).max(SLA_MAX),
        officerMinutes: z.number().int().min(SLA_MIN).max(SLA_MAX),
      })
      .optional(),
    /** 0 = keep evidence forever (default); otherwise 30-3650 days. Deletion is permanent. */
    retentionDays: z.union([z.literal(0), z.number().int().min(30).max(3650)]).optional(),
    /** Allowed vehicle types. A type that a vehicle uses cannot be removed (checked in the callable). */
    vehicleTypes: z
      .array(z.string().trim().min(VEHICLE_TYPE_NAME_MIN).max(VEHICLE_TYPE_NAME_MAX))
      .min(1)
      .max(MAX_VEHICLE_TYPES)
      .optional(),
    /** Days before an expiry date when a record turns "expiring soon". */
    expiryWarningDays: z.number().int().min(MIN_EXPIRY_WARNING_DAYS).max(MAX_EXPIRY_WARNING_DAYS).optional(),
    /** Hours before a visit that is still checked in gets a dwell warning (warning only; default 16). */
    dwellLimitHours: z.number().int().min(MIN_DWELL_LIMIT_HOURS).max(MAX_DWELL_LIMIT_HOURS).optional(),
    /** Gate passes: issue every qualified pairing's pass at month rollover (default off). */
    autoIssueGatePasses: z.boolean().optional(),
    /** The qualifications every driver must hold (each valid one year). An empty list requires none. Ids never change. */
    qualificationTypes: z
      .array(z.object({ id: z.string().regex(QUALIFICATION_ID_PATTERN), name: z.string().trim().min(QUALIFICATION_NAME_MIN).max(QUALIFICATION_NAME_MAX) }))
      .max(MAX_QUALIFICATION_TYPES)
      .optional(),
  })
  .refine(
    (v) =>
      v.passSettings !== undefined || v.checklist !== undefined || v.rejectionReasons !== undefined || v.gates !== undefined || v.sla !== undefined || v.retentionDays !== undefined || v.vehicleTypes !== undefined || v.expiryWarningDays !== undefined || v.dwellLimitHours !== undefined || v.autoIssueGatePasses !== undefined || v.qualificationTypes !== undefined,
    { message: 'Nothing to update' },
  )

// ---- Qualifications and permits ----------------------------------------------------------------

/** `recordQualification`: the training was completed on `completedOn`; the server adds the year. */
export const recordQualificationSchema = z.object({
  driverId: z.string().min(1).max(128),
  typeId: z.string().regex(QUALIFICATION_ID_PATTERN),
  completedOn: expiryDate,
})

/** `setMyPermits`: the driver's whole list (0-2 numbers). Each number is normalised and checked in the callable. */
export const setMyPermitsSchema = z.object({
  permits: z.array(z.string().min(1).max(100)).max(MAX_PERMITS),
})
export { PERMIT_NUMBER_MAX, PERMIT_NUMBER_MIN }

// ---- Module 5: the gate ----------------------------------------------------------------------

/** Client UUID that makes a gate call idempotent. */
const requestId = z.uuid()
const gateId = z.string().min(1).max(40)

export const checkInSchema = z.object({
  passId,
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  gateId,
  requestId,
  /** Device time of a check-in captured offline. Bounded in core, never trusted beyond that. */
  offlineCapturedAt: isoString.optional(),
})

export const denyEntrySchema = z.object({
  vehicleId,
  reasonCode,
  note: z.string().trim().max(MAX_DENY_NOTE).optional(),
  gateId,
  requestId,
})

// ---- Module 8: workspace setup (unauthenticated) ---------------------------------------------

export const validateSetupInviteSchema = z.object({ code: z.string().max(200) })

export const completeSetupSchema = z.object({
  code: z.string().max(200),
  companyName: z.string().trim().min(2).max(80),
  adminName: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(128),
  timezone: z.string().trim().max(64).optional(),
})
export type CompleteSetupInput = z.infer<typeof completeSetupSchema>

export const signUpSuperAdminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(128),
})
export type SignUpSuperAdminInput = z.infer<typeof signUpSuperAdminSchema>

// ---- Module 9: operator console --------------------------------------------------------------

export const INVITE_PREFIX_PATTERN = /^[0-9a-f]{8}$/
const pageCursor = z.string().regex(/^\d{1,15}$/)

export const createSetupInviteSchema = z.object({
  companyHint: z.string().trim().max(80).optional(),
  lockEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
})
export type CreateSetupInviteInput = z.infer<typeof createSetupInviteSchema>

export const listSetupInvitesSchema = z.object({
  status: z.enum(['unused', 'claimed', 'used', 'expired']).optional(),
  cursor: pageCursor.optional(),
})

export const revokeSetupInviteSchema = z.object({ hashPrefix: z.string().trim().toLowerCase().regex(INVITE_PREFIX_PATTERN) })

export const listTenantsSchema = z.object({ cursor: pageCursor.optional() })

// ---- Module 10: super admin workspaces and admins --------------------------------------------

const ws_id = z.string().trim().min(1).max(128)
const person = z.string().trim().min(2).max(60)
const adminEmail = z.string().trim().toLowerCase().email().max(254)

export const createWorkspaceSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  timezone: z.string().trim().max(64).optional(),
  adminName: person,
  adminEmail,
})
export const addTenantAdminSchema = z.object({ tenantId: ws_id, name: person, email: adminEmail })
export const tenantAdminTargetSchema = z.object({ tenantId: ws_id, uid: ws_id })
export const setTenantAdminStatusSchema = tenantAdminTargetSchema.extend({ status: z.enum(['active', 'disabled']) })
export const updateTenantAdminSchema = tenantAdminTargetSchema.extend({ name: person })
export const getWorkspaceSchema = z.object({ tenantId: ws_id })

// ---- Penalties -----------------------------------------------------------------------------

const recordId = z.string().trim().min(1).max(128)
const penaltyTypeName = z.string().trim().min(PENALTY_TYPE_NAME_MIN).max(PENALTY_TYPE_NAME_MAX)

export const createPenaltyTypeSchema = z.object({ name: penaltyTypeName })
export const updatePenaltyTypeSchema = z.object({ typeId: recordId, name: penaltyTypeName })
export const deletePenaltyTypeSchema = z.object({ typeId: recordId })

export const issuePenaltySchema = z
  .object({
    /** `pen_` + 10 chars, chosen by the browser so the evidence photo can be uploaded first. */
    penaltyId: z.string().regex(PENALTY_ID_PATTERN),
    driverId: recordId.optional(),
    vehicleId: recordId.optional(),
    typeId: recordId,
    duration: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('permanent') }),
      /** A calendar date in the company's timezone: the penalty blocks through the end of that day. */
      z.object({ kind: z.literal('fixed'), endDate: expiryDate }),
    ]),
    reason: z.string().trim().min(PENALTY_REASON_MIN).max(PENALTY_REASON_MAX),
    hasEvidence: z.boolean().optional(),
  })
  .refine((v) => v.driverId !== undefined || v.vehicleId !== undefined, { message: 'target required' })

export const revokePenaltySchema = z.object({
  penaltyId: z.string().regex(PENALTY_ID_PATTERN),
  note: z.string().trim().min(PENALTY_REASON_MIN).max(PENALTY_NOTE_MAX),
})

export const verifyPenaltySchema = z.object({
  penaltyId: z.string().regex(PENALTY_ID_PATTERN),
  note: z.string().trim().max(PENALTY_NOTE_MAX).optional(),
})

export const checkEligibilitySchema = z
  .object({ vehicleId: recordId.optional(), driverId: recordId.optional() })
  .refine((v) => v.vehicleId !== undefined || v.driverId !== undefined, { message: 'vehicleId or driverId required' })

// ---- Inspections ---------------------------------------------------------------------------

export const recordInspectionSchema = z.object({
  /** `insp_` + 10 chars, chosen by the browser: a retry of the same call is idempotent. */
  inspectionId: z.string().regex(INSPECTION_ID_PATTERN),
  vehicleId: recordId,
  result: z.enum(INSPECTION_RESULTS),
  notes: z.string().trim().max(INSPECTION_NOTES_MAX).default(''),
})

export const withdrawClearanceSchema = z.object({
  vehicleId: recordId,
  note: z.string().trim().min(1).max(INSPECTION_NOTES_MAX),
})

// ---- Visit lifecycle ---------------------------------------------------------------------

const visitId = z.string().regex(VISIT_ID_PATTERN)

/** The PIN is the driver's, typed at the gate. It is validated by `normalisePin` and never stored or logged. */
export const checkInVisitSchema = z.object({
  visitId,
  vehicleId,
  gateId: gateId.optional(),
  requestId,
})

export const checkOutVisitSchema = z.object({ visitId, requestId })

export const logUnloadingCheckSchema = z.object({
  visitId,
  unloaded: z.boolean(),
  unloadLocation: z.string().trim().min(UNLOAD_LOCATION_MIN).max(UNLOAD_LOCATION_MAX).nullable().optional(),
})

// ---- Gate passes (monthly) -----------------------------------------------------------------

const month = z.string().refine(isValidMonth, 'invalid month')
export const MAX_ISSUE_ITEMS = 200

export const issueGatePassesSchema = z.object({
  /** The current month (catch-up) or the next one; the server checks it against the company timezone. */
  month,
  pairs: z
    .array(z.object({ vehicleId: recordId, driverId: recordId }))
    .min(1)
    .max(MAX_ISSUE_ITEMS),
})

export const blockGatePassSchema = z.object({
  passId: recordId,
  note: z.string().trim().min(MANUAL_BLOCK_NOTE_MIN).max(MANUAL_BLOCK_NOTE_MAX),
})

export const reactivateGatePassSchema = z.object({ passId: recordId })

export const refreshQualificationSchema = z.object({ month })
