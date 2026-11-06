import type { Timestamp } from 'firebase/firestore'
import type { PassChecklistItem, PassWithId } from '@/types/passes'

export const ts = (ms: number): Timestamp => ({ toMillis: () => ms }) as unknown as Timestamp

export const TODAY = '20260310'
export const YESTERDAY = '20260309'

const yes = (id: string): PassChecklistItem => ({ id, label: `Item ${id}`, answer: 'yes' })
export const no = (id: string): PassChecklistItem => ({ id, label: `Item ${id}`, answer: 'no', note: 'Loose cable' })

/** A submitted pass for today with an all-Yes checklist; override anything. */
export function makePass(over: Partial<PassWithId> = {}): PassWithId {
  const id = over.id ?? 'veh_aaaaaaaaaa_20260310'
  return {
    id,
    tenantId: 'T1',
    contractorId: 'C1',
    vehicleId: 'veh_aaaaaaaaaa',
    plateNo: 'WP LJ-4821',
    vehicleType: 'Tipper',
    dateKey: TODAY,
    driverId: 'drv1',
    driverName: 'Sunil Rathnayake',
    status: 'submitted',
    attempt: 1,
    submittedAt: ts(Date.now() - 5 * 60_000),
    updatedAt: ts(Date.now()),
    checklist: [yes('a'), yes('b')],
    evidence: {
      gps: { path: 'tenants/T1/passes/veh_aaaaaaaaaa/20260310/1/gps.jpg', size: 50_000, contentType: 'image/jpeg' },
      dashcam: { path: 'tenants/T1/passes/veh_aaaaaaaaaa/20260310/1/dashcam.jpg', size: 50_000, contentType: 'image/jpeg' },
      extra: [],
    },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    ...over,
  }
}
