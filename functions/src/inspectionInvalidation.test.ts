import { beforeEach, describe, expect, it } from 'vitest'
import { becameExpired, invalidateForDriverExpiry, invalidateForPenalty, invalidateForVehicleExpiry } from './inspectionInvalidation.js'
import { recordInspection } from './inspections.js'
import { NOW, caller, makeWorld, type World } from './test-utils.js'
import type { PenaltyData } from './types.js'

const NOW_MS = NOW * 1000
const LATER = NOW_MS + 60_000
const V1 = 'veh_aaaaaaaaaa'
const V2 = 'veh_bbbbbbbbbb'

let w: World
let n = 0
beforeEach(() => {
  w = makeWorld()
  const base = { tenantId: 'T1', contractorId: 'C1', type: 'Tipper', status: 'active' as const }
  w.vehicles.set(V1, { ...base, plateNo: 'WP A-1', plateKey: 'WPA1', assignedDriverIds: ['drv1'] })
  w.vehicles.set(V2, { ...base, plateNo: 'WP B-2', plateKey: 'WPB2', assignedDriverIds: ['drv1', 'drv1b'] })
})

const approve = async (vehicleId: string) =>
  (await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: `insp_${String(++n).padStart(10, 'a')}`, vehicleId, result: 'approved', notes: '' })).inspectionId

const penalty = (target: PenaltyData['target'], over: Partial<PenaltyData> = {}): PenaltyData => ({
  tenantId: 'T1', contractorId: 'C1', target, targetLabels: { driverName: null, plateNo: null }, typeId: 'pty_1', typeName: 'Safety Violation',
  duration: { kind: 'permanent' }, issuedBy: { uid: 'safe1', name: 'Sam', role: 'safety' }, issuedAt: LATER, reason: 'Secret reason', evidencePhotoPath: null,
  status: 'active', verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
})

describe('invalidateForPenalty', () => {
  it('a vehicle penalty cancels that vehicle’s approval only', async () => {
    const i1 = await approve(V1)
    const i2 = await approve(V2)
    const res = await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: null, vehicleId: V1 }), LATER)
    expect(res).toEqual({ vehicles: 1, invalidated: 1 })
    expect(w.inspections.get(i1)).toMatchObject({ status: 'invalidated', invalidatedReason: 'penalty_issued', invalidatedAt: LATER, invalidationSource: 'pen_x' })
    expect(w.vehicles.get(V1)?.clearance).toMatchObject({ status: 'needs_reinspection', reason: 'penalty_issued', at: LATER })
    expect(w.inspections.get(i2)?.status).toBe('active')
    expect(w.audits.at(-1)).toMatchObject({ action: 'inspection.invalidate', actorUid: 'system', actorRole: 'system', targetId: i1, meta: { vehicleId: V1, reason: 'penalty_issued' } })
  })

  it('a driver penalty cancels every vehicle that driver is assigned to', async () => {
    await approve(V1)
    await approve(V2)
    const res = await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: 'drv1', vehicleId: null }), LATER)
    expect(res.invalidated).toBe(2)
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('needs_reinspection')
    expect(w.vehicles.get(V2)?.clearance?.status).toBe('needs_reinspection')
  })

  it('a driver penalty leaves vehicles the driver is not assigned to alone', async () => {
    await approve(V1)
    const i2 = await approve(V2)
    await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: 'drv1b', vehicleId: null }), LATER)
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
    expect(w.inspections.get(i2)?.status).toBe('invalidated')
  })

  it('a penalty on both counts the shared vehicle once', async () => {
    await approve(V1)
    const res = await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: 'drv1', vehicleId: V1 }), LATER)
    // V1 (named, and drv1's) once; V2 (drv1's, never inspected) is looked at and left alone.
    expect(res).toEqual({ vehicles: 2, invalidated: 1 })
    expect(w.audits.filter((a) => a.action === 'inspection.invalidate')).toHaveLength(1)
  })

  it('is idempotent: a repeated delivery changes and audits nothing', async () => {
    await approve(V1)
    await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: null, vehicleId: V1 }), LATER)
    const audits = w.audits.length
    expect(await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: null, vehicleId: V1 }), LATER + 5)).toEqual({ vehicles: 1, invalidated: 0 })
    expect(w.audits).toHaveLength(audits)
  })

  it('a late or retried delivery never cancels an inspection made after the penalty', async () => {
    const penaltyAt = NOW_MS - 1000
    const id = await approve(V1) // inspectedAt = NOW_MS, after the penalty
    expect(await invalidateForPenalty(w.deps.data, 'pen_old', penalty({ driverId: null, vehicleId: V1 }, { issuedAt: penaltyAt }), LATER)).toMatchObject({ invalidated: 0 })
    expect(w.inspections.get(id)?.status).toBe('active')
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
  })

  it('leaves never-inspected, rejected and other-tenant vehicles alone', async () => {
    await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: 'insp_rejectedaa', vehicleId: V2, result: 'rejected', notes: 'Tyres worn' })
    w.vehicles.set('veh_other', { ...w.vehicles.get(V1)!, tenantId: 'T2', assignedDriverIds: ['drv1'] })
    const res = await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: 'drv1', vehicleId: V1 }), LATER)
    expect(res.invalidated).toBe(0)
    expect(w.vehicles.get(V2)?.clearance?.status).toBe('rejected')
    expect(w.vehicles.get('veh_other')?.clearance).toBeUndefined()
  })

  it('ignores a penalty that is not active', async () => {
    await approve(V1)
    expect(await invalidateForPenalty(w.deps.data, 'pen_x', penalty({ driverId: null, vehicleId: V1 }, { status: 'revoked' }), LATER)).toEqual({ vehicles: 0, invalidated: 0 })
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
  })

  it('tries every vehicle, then throws so the trigger retries', async () => {
    await approve(V1)
    await approve(V2)
    const data = w.deps.data
    let calls = 0
    const flaky = { ...data, inspectionTx: (p: Parameters<typeof data.inspectionTx>[0]) => (++calls === 1 ? Promise.reject(new Error('boom')) : data.inspectionTx(p)) }
    await expect(invalidateForPenalty(flaky, 'pen_x', penalty({ driverId: 'drv1', vehicleId: null }), LATER)).rejects.toThrow('boom')
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
    expect(w.vehicles.get(V2)?.clearance?.status).toBe('needs_reinspection')
    // The retry finishes the job.
    expect(await invalidateForPenalty(data, 'pen_x', penalty({ driverId: 'drv1', vehicleId: null }), LATER)).toMatchObject({ invalidated: 1 })
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('needs_reinspection')
  })
})

describe('invalidateForVehicleExpiry', () => {
  it('cancels the approval with reason document_expired while the vehicle is still expired', async () => {
    const id = await approve(V1)
    w.vehicles.set(V1, { ...w.vehicles.get(V1)!, eligibilityStatus: 'expired' })
    expect(await invalidateForVehicleExpiry(w.deps.data, 'T1', V1, LATER, LATER)).toEqual({ vehicles: 1, invalidated: 1 })
    expect(w.inspections.get(id)).toMatchObject({ status: 'invalidated', invalidatedReason: 'document_expired', invalidationSource: 'vehicle' })
  })

  it('does nothing when the documents were renewed before the trigger ran', async () => {
    await approve(V1)
    w.vehicles.set(V1, { ...w.vehicles.get(V1)!, eligibilityStatus: 'valid' })
    expect(await invalidateForVehicleExpiry(w.deps.data, 'T1', V1, LATER, LATER)).toMatchObject({ invalidated: 0 })
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
  })

  it('does nothing for a vehicle never inspected, and not for another tenant', async () => {
    w.vehicles.set(V1, { ...w.vehicles.get(V1)!, eligibilityStatus: 'expired' })
    expect(await invalidateForVehicleExpiry(w.deps.data, 'T1', V1, LATER, LATER)).toMatchObject({ invalidated: 0 })
    await approve(V2)
    w.vehicles.set(V2, { ...w.vehicles.get(V2)!, eligibilityStatus: 'expired' })
    expect(await invalidateForVehicleExpiry(w.deps.data, 'T2', V2, LATER, LATER)).toMatchObject({ invalidated: 0 })
  })
})

describe('invalidateForDriverExpiry', () => {
  it('a lapsed licence cancels the approval of each vehicle the driver is assigned to', async () => {
    await approve(V1)
    await approve(V2)
    w.drivers.set('drv1b', { ...w.drivers.get('drv1b')!, eligibilityStatus: 'expired' })
    const res = await invalidateForDriverExpiry(w.deps.data, 'T1', 'drv1b', LATER, LATER)
    expect(res.invalidated).toBe(1)
    expect(w.vehicles.get(V1)?.clearance?.status).toBe('cleared')
    expect(w.inspections.get(w.vehicles.get(V2)!.clearance!.inspectionId)).toMatchObject({ invalidatedReason: 'document_expired', invalidationSource: 'driver:drv1b' })
  })

  it('does nothing if the licence is no longer expired, or the driver belongs to another tenant', async () => {
    await approve(V2)
    expect(await invalidateForDriverExpiry(w.deps.data, 'T1', 'drv1b', LATER, LATER)).toMatchObject({ invalidated: 0 })
    w.drivers.set('drv1b', { ...w.drivers.get('drv1b')!, eligibilityStatus: 'expired' })
    expect(await invalidateForDriverExpiry(w.deps.data, 'T2', 'drv1b', LATER, LATER)).toMatchObject({ invalidated: 0 })
    expect(w.vehicles.get(V2)?.clearance?.status).toBe('cleared')
  })
})

describe('becameExpired', () => {
  it('fires only on the move into expired', () => {
    expect(becameExpired('valid', 'expired')).toBe(true)
    expect(becameExpired(undefined, 'expired')).toBe(true)
    expect(becameExpired('expiringSoon', 'expired')).toBe(true)
    expect(becameExpired('expired', 'expired')).toBe(false)
    expect(becameExpired('expired', 'valid')).toBe(false)
    expect(becameExpired('valid', 'expiringSoon')).toBe(false)
  })
})
