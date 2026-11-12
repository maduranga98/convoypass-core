import { z } from 'zod'
import { VISITOR_ID_PATTERN, VISITOR_PASS_ID_PATTERN } from './ids.js'
import { MAX_MAX_DWELL_MINUTES, MAX_VALID_DAYS, MIN_MAX_DWELL_MINUTES } from './visitorLogic.js'
import { isExpiryDate } from './expiry.js'

const text = (min: number, max: number) => z.string().trim().min(min).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()
const day = z.string().refine(isExpiryDate, 'invalid date')
const requestId = z.uuid()

const visitorFields = {
  fullName: text(2, 100),
  /** As typed: the server normalises a Sri Lankan number and keeps another international number as digits. */
  phone: text(7, 30),
  idNumber: z.string().trim().max(30).nullable().optional(),
  organization: z.string().trim().max(100).nullable().optional(),
}

export const issueVisitorPassSchema = z.object({
  passId: z.string().regex(VISITOR_PASS_ID_PATTERN),
  /** Chosen by the browser: a returning visitor keeps their id; a new one gets a fresh id (the photo is uploaded to its path first). */
  visitorId: z.string().regex(VISITOR_ID_PATTERN),
  visitor: z.object(visitorFields),
  /** The browser uploaded a photo to this visitor's path: the server verifies it before using it. */
  hasPhoto: z.boolean().optional(),
  hostName: optionalText(100),
  purposeOfVisit: text(3, 200),
  siteId: z.string().trim().min(1).max(40).optional(),
  /** `YYYY-MM-DD` in the company timezone. Default: today, for the company's default number of days. */
  validFrom: day.optional(),
  validUntil: day.optional(),
  notes: optionalText(500),
})
export type IssueVisitorPassInput = z.infer<typeof issueVisitorPassSchema>

export const updateVisitorSchema = z.object({
  visitorId: z.string().regex(VISITOR_ID_PATTERN),
  fullName: visitorFields.fullName.optional(),
  phone: visitorFields.phone.optional(),
  idNumber: visitorFields.idNumber,
  organization: visitorFields.organization,
  hasPhoto: z.boolean().optional(),
})

export const revokeVisitorPassSchema = z.object({
  passId: z.string().regex(VISITOR_PASS_ID_PATTERN),
  reason: optionalText(200),
})

/** A pass is found by the code on its slip or QR (typed or scanned) or by its id. */
export const lookupVisitorPassSchema = z
  .object({ code: z.string().trim().min(1).max(60).optional(), passId: z.string().regex(VISITOR_PASS_ID_PATTERN).optional() })
  .refine((v) => (v.code === undefined) !== (v.passId === undefined), 'code or passId')

export const checkInVisitorPassSchema = z
  .object({
    code: z.string().trim().min(1).max(60).optional(),
    passId: z.string().regex(VISITOR_PASS_ID_PATTERN).optional(),
    /** A gate id from the company's gates. */
    siteId: z.string().trim().min(1).max(40),
    requestId,
  })
  .refine((v) => (v.code === undefined) !== (v.passId === undefined), 'code or passId')

export const checkOutVisitorPassSchema = z.object({ passId: z.string().regex(VISITOR_PASS_ID_PATTERN), requestId })

export const updateVisitorSettingsSchema = z
  .object({
    maxDwellMinutes: z.number().int().min(MIN_MAX_DWELL_MINUTES).max(MAX_MAX_DWELL_MINUTES).optional(),
    defaultValidDays: z.number().int().min(1).max(MAX_VALID_DAYS).optional(),
  })
  .refine((v) => v.maxDwellMinutes !== undefined || v.defaultValidDays !== undefined, 'nothing to change')
