// Firestore triggers that cancel a vehicle's approval and, in the same reaction, block its monthly gate passes. Separate from the penalty callables and Module 2's daily
// eligibility job on purpose: both just write their documents, these react. `retry: true` is safe because every
// cancellation is idempotent and ignores causes that happened before the vehicle was last inspected.
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { REGION } from './config.js'
import { dataPort, toPenalty } from './ports.js'
import { blockForClearance, blockForDriverExpiry, blockForPenalty, blockForVehicleExpiry, type BlockingDeps } from './gatePassBlocking.js'
import { gatePassPort } from './gatePassPort.js'
import { becameExpired, invalidateForDriverExpiry, invalidateForPenalty, invalidateForVehicleExpiry } from './inspectionInvalidation.js'

const TRIGGER_REGION = process.env.FIRESTORE_TRIGGER_REGION || REGION

// Keep one data port per instance: the Firestore client is created lazily on first use.
let port: ReturnType<typeof dataPort> | undefined
const ports = () => (port ??= dataPort())
let gatePorts: BlockingDeps | undefined
const blocking = (): BlockingDeps => (gatePorts ??= { port: gatePassPort(), data: ports() })

/** Both reactions always run; if either failed the first error is thrown afterwards so the delivery is retried (both are idempotent). */
async function reactAll(...reactions: (() => Promise<unknown>)[]): Promise<void> {
  const settled = await Promise.allSettled(reactions.map((r) => r()))
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
  if (failed) throw failed.reason
}

const needsInspection = (status: string | undefined): boolean => status === 'needs_reinspection' || status === 'rejected'

/** A new penalty (Module 3) against a vehicle or its driver. */
export const invalidateInspectionOnPenalty = onDocumentCreated({ document: 'penalties/{penaltyId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const raw = event.data?.data()
  if (!raw) return
  const penalty = toPenalty(raw)
  const now = Date.now()
  await reactAll(
    () => invalidateForPenalty(ports(), event.params.penaltyId, penalty, now),
    () => blockForPenalty(blocking(), event.params.penaltyId, penalty, now),
  )
})

/** `eligibilityStatus` written by Module 2: the daily job, or a callable that saved an already-expired date. */
export const invalidateInspectionOnVehicleExpiry = onDocumentUpdated({ document: 'vehicles/{vehicleId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  type VehicleDoc = { tenantId?: string; eligibilityStatus?: string; clearance?: { status?: string } }
  const before = event.data?.before.data() as VehicleDoc | undefined
  const after = event.data?.after.data() as VehicleDoc | undefined
  const tenantId = after?.tenantId
  if (!tenantId) return
  const now = Date.now()
  const reactions: (() => Promise<unknown>)[] = []
  if (becameExpired(before?.eligibilityStatus, after?.eligibilityStatus)) {
    reactions.push(() => invalidateForVehicleExpiry(ports(), tenantId, event.params.vehicleId, Date.parse(event.time), now), () => blockForVehicleExpiry(blocking(), tenantId, event.params.vehicleId, now))
  }
  // The clearance (written with the inspection record) just stopped being "cleared": withdrawn, rejected, or cancelled by an event.
  if (needsInspection(after?.clearance?.status) && before?.clearance?.status !== after?.clearance?.status) {
    reactions.push(() => blockForClearance(blocking(), tenantId, event.params.vehicleId, now))
  }
  if (reactions.length > 0) await reactAll(...reactions)
})

export const invalidateInspectionOnDriverExpiry = onDocumentUpdated({ document: 'drivers/{driverId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const before = event.data?.before.data() as { eligibilityStatus?: string } | undefined
  const after = event.data?.after.data() as { tenantId?: string; eligibilityStatus?: string } | undefined
  if (!after?.tenantId || !becameExpired(before?.eligibilityStatus, after.eligibilityStatus)) return
  const tenantId = after.tenantId
  const now = Date.now()
  await reactAll(
    () => invalidateForDriverExpiry(ports(), tenantId, event.params.driverId, Date.parse(event.time), now),
    () => blockForDriverExpiry(blocking(), tenantId, event.params.driverId, now),
  )
})

