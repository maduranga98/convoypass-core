import type { Timestamp } from 'firebase/firestore'
import type { EntryCheck, VisitorPassStatus } from '@/lib/visitorLogic'

/** `visitors/{vst_…}`: function-written; admin and supervisors read. */
export interface Visitor {
  tenantId: string
  fullName: string
  phone: string
  idNumber: string | null
  idKey: string | null
  organization: string | null
  /** A Storage path, never a URL. */
  photoPath: string | null
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

/** `visitorPasses/{vsp_…}`: function-written; clients only read. */
export interface VisitorPass {
  tenantId: string
  visitorId: string
  visitorName: string
  visitorOrganization: string | null
  hostName: string | null
  purposeOfVisit: string
  photoPath: string | null
  siteId: string
  siteName: string
  passCode: string
  status: VisitorPassStatus
  month: string
  issuedAt: Timestamp
  issuedBy: { uid: string; name: string; role: string }
  validFrom: Timestamp
  validUntil: Timestamp
  maxDwellMinutes: number
  checkInAt: Timestamp | null
  checkInBy: { uid: string; name: string } | null
  checkOutAt: Timestamp | null
  checkOutBy: { uid: string; name: string } | null
  dwellWarning: boolean
  revokedAt: Timestamp | null
  revokedBy: { uid: string; name: string } | null
  revokeReason: string | null
  notes: string
}

export interface IssueVisitorPassPayload {
  passId: string
  visitorId: string
  visitor: { fullName: string; phone: string; idNumber?: string | null; organization?: string | null }
  hasPhoto?: boolean
  hostName?: string
  purposeOfVisit: string
  siteId?: string
  validFrom?: string
  validUntil?: string
  notes?: string
}

export interface IssueVisitorPassResult {
  passId: string
  visitorId: string
  passCode: string
  qrPayload: string
  validFrom: number
  validUntil: number
  siteId: string
  siteName: string
  used: number
  cap: number | null
  created: boolean
}

export interface VisitorPassView {
  passId: string
  passCode: string
  status: VisitorPassStatus
  entry: EntryCheck
  visitorName: string
  organization: string | null
  hostName: string | null
  purposeOfVisit: string
  photoPath: string | null
  siteId: string
  siteName: string
  validFrom: number
  validUntil: number
  maxDwellMinutes: number
  checkInAt: number | null
  checkInByName: string | null
  checkOutAt: number | null
  overstay: boolean
  revokeReason: string | null
}

export interface VisitorMovementResult {
  passId: string
  visitorName: string
  at: number
  recorded: boolean
}
