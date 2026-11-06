import type { Clearance, ClearanceStatus } from '@/lib/inspectionLogic'
import { strings } from '@/lib/strings'
import type { Vehicle } from '@/types'

/** The clearance a list or drawer shows for a vehicle: the copy the inspection functions keep on it. Absent = never inspected. */
export const clearanceOfVehicle = (v: Pick<Vehicle, 'clearance'>): Clearance =>
  v.clearance ? { status: v.clearance.status, reason: v.clearance.reason } : { status: 'never_inspected', reason: null }

/** Why a vehicle is in the re-inspection list: the cancellation reason, or a rejected inspection. */
export const reinspectionReason = (c: Clearance): string =>
  c.status === 'needs_reinspection' && c.reason ? strings.inspections.reason[c.reason] : strings.inspections.list.rejectedReason

export const REINSPECTION_STATUSES: readonly ClearanceStatus[] = ['needs_reinspection', 'rejected']
