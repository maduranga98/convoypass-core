import { beforeEach, describe, expect, it } from 'vitest'
import { ELIGIBILITY_PAGE_SIZE, recomputeEligibility, type EligibilityPort, type StatusUpdate } from './eligibility.js'
import { createVehicle, updateVehicle } from './vehicles.js'
import { updateTenantSettings } from './passes.js'
import { updateUser } from './core.js'
import { admin, makeWorld, NOW, rejects, sup1, sup2, type World } from './test-utils.js'
import type { DriverData, TenantData, VehicleData } from './types.js'

// NOW is 2023-11-15 03:43 in Asia/Colombo.
const TODAY = '2023-11-15'
let w: World
beforeEach(() => {
  w = makeWorld()
})

const create = (over: Record<string, unknown> = {}, c = admin()) =>
  createVehicle(w.deps, c, { contractorId: 'C1', plateNo: 'WP LJ-4821', type: 'Tipper', ...over })

describe('createVehicle / updateVehicle expiry', () => {
  it('stores the dates and the derived status', async () => {
    const { vehicleId } = await create({ insuranceExpiry: '2023-11-20', registrationExpiry: '2024-06-01' })
    expect(w.vehicles.get(vehicleId)).toMatchObject({
      insuranceExpiry: '2023-11-20',
      registrationExpiry: '2024-06-01',
      eligibilityStatus: 'expiringSoon',
    })
  })

  it('is expired once any date is past, valid through the expiry day itself', async () => {
    const a = await create({ insuranceExpiry: '2023-11-14' })
    expect(w.vehicles.get(a.vehicleId)?.eligibilityStatus).toBe('expired')
    const b = await create({ plateNo: 'WP LJ-0002', registrationExpiry: TODAY })
    expect(w.vehicles.get(b.vehicleId)?.eligibilityStatus).toBe('expiringSoon')
  })

  it('uses the tenant warning window', async () => {
    w.tenants.set('T1', { ...(w.tenants.get('T1') as TenantData), expiryWarningDays: 3 })
    const { vehicleId } = await create({ insuranceExpiry: '2023-11-20' })
    expect(w.vehicles.get(vehicleId)?.eligibilityStatus).toBe('valid')
  })

  it('rejects malformed dates', async () => {
    await rejects(create({ insuranceExpiry: '15/11/2023' }), 'invalid-argument', 'invalid-input')
    await rejects(create({ insuranceExpiry: '2023-02-30' }), 'invalid-argument', 'invalid-input')
  })

  it('recomputes on update, clears with null, and audits which fields changed', async () => {
    const { vehicleId } = await create({ insuranceExpiry: '2023-11-14' })
    await updateVehicle(w.deps, admin(), { vehicleId, insuranceExpiry: '2025-01-01' })
    expect(w.vehicles.get(vehicleId)).toMatchObject({ insuranceExpiry: '2025-01-01', eligibilityStatus: 'valid' })
    expect(w.audits.at(-1)).toMatchObject({ action: 'vehicle.update', meta: { insuranceExpiry: true } })
    await updateVehicle(w.deps, admin(), { vehicleId, insuranceExpiry: null })
    expect(w.vehicles.get(vehicleId)?.insuranceExpiry).toBeUndefined()
  })

  it('an unchanged date writes nothing', async () => {
    const { vehicleId } = await create({ insuranceExpiry: '2025-01-01' })
    const before = w.audits.length
    await updateVehicle(w.deps, admin(), { vehicleId, insuranceExpiry: '2025-01-01' })
    expect(w.audits.length).toBe(before)
  })

  it('keeps supervisors out of other contractors', async () => {
    const { vehicleId } = await create()
    await rejects(updateVehicle(w.deps, sup2(), { vehicleId, insuranceExpiry: '2025-01-01' }), 'permission-denied')
    await updateVehicle(w.deps, sup1(), { vehicleId, insuranceExpiry: '2025-01-01' })
  })
})

describe('driver licence expiry', () => {
  it('updateUser stores the date and derived status on the drivers doc', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', licenseExpiry: '2023-11-18' })
    expect(w.drivers.get('drv1')).toMatchObject({ licenseExpiry: '2023-11-18', eligibilityStatus: 'expiringSoon' })
    await updateUser(w.deps, admin(), { uid: 'drv1', licenseExpiry: null })
    expect(w.drivers.get('drv1')?.licenseExpiry).toBeNull()
    expect(w.drivers.get('drv1')?.eligibilityStatus).toBe('valid')
  })

  it('refuses a licence expiry on a non-driver', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'sup1', licenseExpiry: '2025-01-01' }), 'invalid-argument', 'invalid-input')
  })
})

describe('vehicle types per tenant', () => {
  it('accepts only the tenant list (defaults when unset)', async () => {
    await rejects(create({ type: 'Hovercraft' }), 'invalid-argument', 'invalid-type')
    await updateTenantSettings(w.deps, admin(), { vehicleTypes: ['Hovercraft', 'Tipper'] })
    await create({ type: 'Hovercraft' })
    await rejects(create({ plateNo: 'WP LJ-0003', type: 'Lorry' }), 'invalid-argument', 'invalid-type')
  })

  it('refuses removing or renaming a type that vehicles use, but allows unused ones', async () => {
    await create({ type: 'Tipper' })
    await rejects(updateTenantSettings(w.deps, admin(), { vehicleTypes: ['Lorry', 'Flatbed'] }), 'failed-precondition', 'type-in-use')
    await updateTenantSettings(w.deps, admin(), { vehicleTypes: ['Tipper', 'Water Bowser'] })
    expect(w.tenants.get('T1')?.vehicleTypes).toEqual(['Tipper', 'Water Bowser'])
  })

  it('rejects duplicates ignoring case, and non-admins', async () => {
    await rejects(updateTenantSettings(w.deps, admin(), { vehicleTypes: ['Tipper', 'tipper'] }), 'invalid-argument', 'invalid-input')
    await rejects(updateTenantSettings(w.deps, sup1(), { vehicleTypes: ['Tipper'] }), 'permission-denied')
  })

  it('stores the warning window within 1-90', async () => {
    await updateTenantSettings(w.deps, admin(), { expiryWarningDays: 30 })
    expect(w.tenants.get('T1')?.expiryWarningDays).toBe(30)
    await rejects(updateTenantSettings(w.deps, admin(), { expiryWarningDays: 0 }), 'invalid-argument')
    await rejects(updateTenantSettings(w.deps, admin(), { expiryWarningDays: 91 }), 'invalid-argument')
  })
})

// ---- the daily job -----------------------------------------------------------------------------

type Rec<T> = { id: string; data: T }

function fakePort(tenants: Rec<TenantData>[], vehicles: Rec<VehicleData>[], drivers: Rec<DriverData>[]): EligibilityPort & { writes: StatusUpdate[] } {
  const writes: StatusUpdate[] = []
  const page = <T extends { tenantId: string }>(all: Rec<T>[], tenantId: string, after: string | null, limit: number) =>
    all
      .filter((r) => r.data.tenantId === tenantId && (after === null || r.id > after))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit)
  const apply = (all: Rec<{ eligibilityStatus?: string }>[]) => async (updates: StatusUpdate[]) => {
    for (const u of updates) {
      const rec = all.find((r) => r.id === u.id)
      if (rec) rec.data.eligibilityStatus = u.status
      writes.push(u)
    }
    return updates.length
  }
  return {
    writes,
    listTenants: async () => tenants,
    listVehicles: async (t, a, l) => page(vehicles, t, a, l),
    listDrivers: async (t, a, l) => page(drivers, t, a, l),
    applyVehicleStatuses: apply(vehicles),
    applyDriverStatuses: apply(drivers),
  }
}

const veh = (id: string, tenantId: string, over: Partial<VehicleData> = {}): Rec<VehicleData> => ({
  id,
  data: { tenantId, contractorId: 'C1', plateNo: id, plateKey: id, type: 'Tipper', assignedDriverIds: [], status: 'active', ...over },
})
const drv = (id: string, tenantId: string, over: Partial<DriverData> = {}): Rec<DriverData> => ({
  id,
  data: { tenantId, contractorId: 'C1', name: id, phone: null, status: 'active', ...over },
})

describe('recomputeEligibility', () => {
  const now = NOW * 1000

  it('writes only the records whose status changed, and a second run writes nothing', async () => {
    const port = fakePort(
      [{ id: 'T1', data: { timezone: 'Asia/Colombo' } }],
      [
        veh('v1', 'T1', { insuranceExpiry: '2023-11-01', eligibilityStatus: 'valid' }), // went stale: expired
        veh('v2', 'T1', { insuranceExpiry: '2024-12-01', eligibilityStatus: 'valid' }), // unchanged
        veh('v3', 'T1'), // legacy, no dates, no status yet: becomes valid
        veh('v4', 'T1', { registrationExpiry: '2023-11-20', eligibilityStatus: 'valid' }), // entered the window
      ],
      [drv('d1', 'T1', { licenseExpiry: '2023-11-10' })],
    )
    const first = await recomputeEligibility(port, now)
    expect(first).toMatchObject({ tenants: 1, vehicles: 4, drivers: 1, changed: 4, failedTenants: 0 })
    expect(port.writes.map((u) => [u.id, u.status])).toEqual([
      ['v1', 'expired'],
      ['v3', 'valid'],
      ['v4', 'expiringSoon'],
      ['d1', 'expired'],
    ])
    port.writes.length = 0
    expect((await recomputeEligibility(port, now)).changed).toBe(0)
    expect(port.writes).toEqual([])
  })

  it('passes the dates it computed from, so a concurrent edit is not overwritten', async () => {
    const port = fakePort([{ id: 'T1', data: {} }], [veh('v1', 'T1', { insuranceExpiry: '2023-11-01' })], [])
    await recomputeEligibility(port, now)
    expect(port.writes[0]?.dates).toEqual({ insuranceExpiry: '2023-11-01', registrationExpiry: null, annualInspectionExpiry: null })
  })

  it("uses each tenant's own timezone and warning window", async () => {
    // 2023-11-14 22:13 UTC: still the 14th in Los Angeles, already the 15th in Colombo.
    const port = fakePort(
      [
        { id: 'T1', data: { timezone: 'Asia/Colombo' } },
        { id: 'T2', data: { timezone: 'America/Los_Angeles', expiryWarningDays: 30 } },
      ],
      [
        veh('a', 'T1', { insuranceExpiry: '2023-11-14' }),
        veh('b', 'T2', { insuranceExpiry: '2023-11-14' }),
        veh('c', 'T2', { insuranceExpiry: '2023-12-10' }),
      ],
      [],
    )
    await recomputeEligibility(port, now)
    expect(Object.fromEntries(port.writes.map((u) => [u.id, u.status]))).toEqual({ a: 'expired', b: 'expiringSoon', c: 'expiringSoon' })
  })

  it('never crosses tenants and pages through large collections', async () => {
    const many = Array.from({ length: ELIGIBILITY_PAGE_SIZE + 5 }, (_, i) => veh(`v${String(i).padStart(4, '0')}`, 'T1', { insuranceExpiry: '2000-01-01' }))
    const port = fakePort([{ id: 'T1', data: {} }, { id: 'T2', data: {} }], [...many, veh('other', 'T2')], [])
    const summary = await recomputeEligibility(port, now)
    expect(summary.vehicles).toBe(ELIGIBILITY_PAGE_SIZE + 6)
    expect(port.writes.filter((u) => u.status === 'expired')).toHaveLength(ELIGIBILITY_PAGE_SIZE + 5)
  })

  it('one failing tenant does not stop the others', async () => {
    const port = fakePort([{ id: 'T1', data: {} }, { id: 'T2', data: {} }], [veh('x', 'T2', { insuranceExpiry: '2000-01-01' })], [])
    const list = port.listVehicles
    port.listVehicles = async (t, a, l) => {
      if (t === 'T1') throw new Error('boom')
      return list(t, a, l)
    }
    const summary = await recomputeEligibility(port, now)
    expect(summary).toMatchObject({ failedTenants: 1, changed: 1 })
  })
})
