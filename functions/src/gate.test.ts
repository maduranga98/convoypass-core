import { beforeEach, describe, expect, it } from 'vitest'
import { revokePass } from './approvals.js'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { checkIn, denyEntry, OFFLINE_MAX_AGE_MS } from './gate.js'
import { resolveVehicle, updateTenantSettings } from './passes.js'
import { admin, caller, drv1, makeWorld, NOW, rejects, sup1, userDoc, type World } from './test-utils.js'
import type { Caller, PassData, PassStatus } from './types.js'

const VID = 'veh_aaaaaaaaaa'
// NOW is 2023-11-14 22:13:20 UTC = 2023-11-15 03:43:20 in Colombo.
const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const YESTERDAY = dateKey('Asia/Colombo', new Date((NOW - 86_400) * 1000))
const pid = (day = DAY) => `${VID}_${day}`
const NOW_MS = NOW * 1000
const iso = (ms: number) => new Date(ms).toISOString()

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

const security = (over: Partial<Caller> = {}) => caller('sec', 'security', null, over)
const officer = () => caller('officer', 'officer')

let w: World
beforeEach(() => {
  w = makeWorld()
  w.users.set('sec', userDoc({ role: 'security', contractorId: null, name: 'Sam Security', email: 'sec@x.com', phone: null }))
  w.users.set('sec2', userDoc({ role: 'security', contractorId: null, name: 'Nimal Guard', email: 'sec2@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1', name: 'Dan Driver' }))
  w.tenants.set('T1', { timezone: 'Asia/Colombo', gates: [{ id: 'main', name: 'Main Gate' }, { id: 'north', name: 'North Gate' }] })
  w.vehicles.set(VID, {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper',
    assignedDriverIds: ['drv1'], status: 'active',
  })
})

const seed = (status: PassStatus, over: Partial<PassData> = {}, id = pid()): PassData => {
  const p: PassData = {
    tenantId: 'T1', contractorId: 'C1', vehicleId: VID, plateNo: 'WP LJ-4821', vehicleType: 'Tipper', dateKey: DAY,
    driverId: 'drv1', driverName: 'Dan Driver', status, attempt: 1, submittedAt: NOW_MS - 60_000,
    checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, label: c.label, answer: 'yes' as const })),
    evidence: {
      gps: { path: 'p/gps.jpg', size: 1, contentType: 'image/jpeg' },
      dashcam: { path: 'p/dashcam.jpg', size: 1, contentType: 'image/jpeg' },
      extra: [],
    },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    supervisor: { uid: 'sup1', name: 'Sue', at: NOW_MS - 50_000 },
    officer: { uid: 'officer', name: 'Olga', at: NOW_MS - 40_000 },
    ...over,
  }
  w.passes.set(id, p)
  return p
}
const stored = (id = pid()) => w.passes.get(id) as PassData

const doCheckIn = (c: Caller = security(), over: Record<string, unknown> = {}) =>
  checkIn(w.deps, c, { passId: pid(), expectedAttempt: 1, gateId: 'main', requestId: R1, ...over })

describe('checkIn: success', () => {
  it('moves officer_approved -> checked_in with the checkIn block, history and audit; time is the server’s', async () => {
    seed('officer_approved', { history: [{ action: 'approve', stage: 'officer', byUid: 'officer', byName: 'Olga', byRole: 'officer', at: 1, attempt: 1 }] })
    expect(await doCheckIn(security(), { gateId: 'north' })).toEqual({ passId: pid(), status: 'checked_in', at: NOW_MS })
    expect(stored()).toMatchObject({
      status: 'checked_in',
      checkIn: { uid: 'sec', name: 'Sam Security', at: NOW_MS, gateId: 'north', gateName: 'North Gate', requestId: R1 },
      officer: { uid: 'officer' },
    })
    expect(stored().checkIn?.offlineCapturedAt).toBeUndefined()
    expect(stored().history).toHaveLength(2)
    expect(stored().history?.at(-1)).toEqual({
      action: 'check_in', stage: 'gate', byUid: 'sec', byName: 'Sam Security', byRole: 'security', at: NOW_MS, attempt: 1,
    })
    expect(w.audits.at(-1)).toMatchObject({
      action: 'pass.checkIn', targetType: 'pass', targetId: pid(), actorUid: 'sec', actorRole: 'security',
      meta: { gateId: 'north', requestId: R1, offline: false, attempt: 1 },
    })
  })
  it('opens the day’s first gate visit with the pass check-in (an id derived from the request, so a replay finds it)', async () => {
    seed('officer_approved')
    await doCheckIn()
    const [id, visit] = [...w.openedVisits][0] as [string, import('./types.js').VisitData]
    expect(id).toBe('vis_1111111111')
    expect(visit).toMatchObject({
      tenantId: 'T1', vehicleId: VID, passId: pid(), driverId: 'drv1', driverName: 'Dan Driver', plateNo: 'WP LJ-4821', status: 'checked_in',
      driverOnDutyLock: true, checkOut: null, checkIn: { timestamp: NOW_MS, dateKey: DAY, securityUserId: 'sec', gateId: 'main', requestId: R1 },
    })
    await doCheckIn() // the same request again: nothing new is opened
    expect(w.openedVisits.size).toBe(1)
  })
  it('uses the default Main Gate when the tenant has no gates configured', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo' })
    seed('officer_approved')
    await doCheckIn()
    expect(stored().checkIn).toMatchObject({ gateId: 'main', gateName: 'Main Gate' })
  })
})

describe('checkIn: who may', () => {
  it('only security: admin, officer, supervisor and driver are refused and nothing changes', async () => {
    seed('officer_approved')
    for (const c of [admin(), officer(), sup1(), drv1()]) await rejects(doCheckIn(c), 'permission-denied', 'forbidden')
    expect(stored().status).toBe('officer_approved')
    expect(w.audits).toHaveLength(0)
  })
  it('an inactive or mismatched security account is refused', async () => {
    seed('officer_approved')
    w.users.set('sec', userDoc({ role: 'security', contractorId: null, status: 'disabled', email: 'sec@x.com', phone: null }))
    await rejects(doCheckIn(), 'permission-denied', 'caller-not-active')
  })
  it('a guard of another tenant cannot check in this tenant’s pass', async () => {
    seed('officer_approved')
    w.users.set('secT2', userDoc({ tenantId: 'T2', role: 'security', contractorId: null, email: 'x@y.com', phone: null }))
    await rejects(doCheckIn(caller('secT2', 'security', null, { tenantId: 'T2' })), 'permission-denied', 'tenant-mismatch')
    expect(stored().status).toBe('officer_approved')
  })
})

describe('checkIn: refusals', () => {
  it('pass must exist', async () => {
    await rejects(doCheckIn(), 'not-found', 'pass-not-found')
  })
  it('pass must be officer_approved (submitted, supervisor_approved, rejected)', async () => {
    for (const status of ['submitted', 'supervisor_approved', 'rejected'] as const) {
      seed(status)
      await expect(doCheckIn()).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'pass-not-approved', status } })
      expect(stored().status).toBe(status)
    }
  })
  it('wrong attempt is "pass changed"', async () => {
    seed('officer_approved', { attempt: 2 })
    await rejects(doCheckIn(), 'failed-precondition', 'pass-changed')
  })
  it('yesterday’s approved pass cannot be checked in online', async () => {
    seed('officer_approved', { dateKey: YESTERDAY }, pid(YESTERDAY))
    await rejects(doCheckIn(security(), { passId: pid(YESTERDAY) }), 'failed-precondition', 'pass-expired')
  })
  it('a suspended vehicle, disabled driver or suspended contractor blocks entry even though the pass is approved', async () => {
    seed('officer_approved')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, status: 'suspended' })
    await rejects(doCheckIn(), 'failed-precondition', 'vehicle-suspended')
    w.vehicles.set(VID, { ...w.vehicles.get(VID)!, status: 'active' })
    w.users.set('drv1', userDoc({ contractorId: 'C1', status: 'disabled' }))
    await rejects(doCheckIn(), 'failed-precondition', 'driver-inactive')
    w.users.set('drv1', userDoc({ contractorId: 'C1' }))
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(doCheckIn(), 'failed-precondition', 'contractor-suspended')
    expect(stored().status).toBe('officer_approved')
  })
  it('the gate must be one of the tenant’s gates', async () => {
    seed('officer_approved')
    await rejects(doCheckIn(security(), { gateId: 'south' }), 'invalid-argument', 'gate-invalid')
  })
  it('requestId must be a UUID; the payload is validated', async () => {
    seed('officer_approved')
    await rejects(doCheckIn(security(), { requestId: 'abc' }), 'invalid-argument', 'invalid-input')
    await rejects(doCheckIn(security(), { expectedAttempt: 0 }), 'invalid-argument', 'invalid-input')
    await rejects(doCheckIn(security(), { offlineCapturedAt: 'yesterday-ish' }), 'invalid-argument', 'invalid-input')
  })
})

describe('checkIn: penalties override an approved pass', () => {
  const penalise = (target: { driverId: string | null; vehicleId: string | null }, over: Record<string, unknown> = {}) =>
    w.penalties.set('pen_aaaaaaaaaa', {
      tenantId: 'T1', contractorId: 'C1', target, targetLabels: { driverName: null, plateNo: null }, typeId: 't', typeName: 'T',
      duration: { kind: 'permanent' }, issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: NOW_MS, reason: 'Reason', evidencePhotoPath: null,
      status: 'active', verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
    })

  it('refuses entry for a suspended vehicle or driver, and the pass stays officer_approved', async () => {
    for (const target of [{ driverId: null, vehicleId: VID }, { driverId: 'drv1', vehicleId: null }]) {
      seed('officer_approved')
      penalise(target)
      await rejects(doCheckIn(), 'failed-precondition', 'penalty-blocked')
      expect(stored().status).toBe('officer_approved')
    }
  })

  it('lets the vehicle in once the penalty is revoked or has ended', async () => {
    seed('officer_approved')
    penalise({ driverId: null, vehicleId: VID }, { status: 'revoked' })
    await doCheckIn()
    expect(stored().status).toBe('checked_in')
  })

  it('does not break an already checked-in replay when a penalty is issued afterwards', async () => {
    seed('officer_approved')
    await doCheckIn()
    penalise({ driverId: null, vehicleId: VID })
    expect(await doCheckIn()).toMatchObject({ status: 'checked_in' })
  })
})

describe('checkIn: idempotency and races', () => {
  it('the same requestId twice succeeds twice with the stored values and writes once', async () => {
    seed('officer_approved')
    const first = await doCheckIn()
    w.deps.now = () => NOW + 30
    const second = await doCheckIn()
    expect(second).toEqual(first)
    expect(stored().history).toHaveLength(1)
    expect(w.audits.filter((a) => a.action === 'pass.checkIn')).toHaveLength(1)
  })
  it('a different requestId on a checked-in pass fails already-exists, naming who, when and where', async () => {
    seed('officer_approved')
    await doCheckIn()
    await expect(doCheckIn(caller('sec2', 'security'), { requestId: R2 })).rejects.toMatchObject({
      code: 'already-exists',
      details: { reason: 'pass-checked-in', byName: 'Sam Security', at: NOW_MS, gateName: 'Main Gate' },
    })
  })
  it('two simultaneous check-ins: exactly one wins', async () => {
    seed('officer_approved')
    const results = await Promise.allSettled([doCheckIn(security()), doCheckIn(caller('sec2', 'security'), { requestId: R2 })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'already-exists', details: { reason: 'pass-checked-in' } })
    expect(stored().history).toHaveLength(1)
  })
})

describe('checkIn: offline capture time', () => {
  it('accepts a recent capture and stores it separately from the server time', async () => {
    seed('officer_approved')
    const captured = iso(NOW_MS - 5 * 60_000)
    expect(await doCheckIn(security(), { offlineCapturedAt: captured })).toMatchObject({ at: NOW_MS })
    expect(stored().checkIn).toMatchObject({ at: NOW_MS, offlineCapturedAt: captured })
    expect(w.audits.at(-1)?.meta).toMatchObject({ offline: true })
  })
  it('allows up to 2 minutes of clock drift into the future, not more', async () => {
    seed('officer_approved')
    await rejects(doCheckIn(security(), { offlineCapturedAt: iso(NOW_MS + 3 * 60_000) }), 'invalid-argument', 'offline-time-future')
    await doCheckIn(security(), { offlineCapturedAt: iso(NOW_MS + 90_000) })
    expect(stored().status).toBe('checked_in')
  })
  it('refuses a capture older than 12 hours', async () => {
    seed('officer_approved')
    await rejects(doCheckIn(security(), { offlineCapturedAt: iso(NOW_MS - OFFLINE_MAX_AGE_MS - 1000) }), 'failed-precondition', 'offline-time-stale')
  })
  it('a check-in captured at 23:55 syncs after midnight against that day’s pass', async () => {
    // 23:55 on the 14th in Colombo = 18:25 UTC, before NOW (22:13 UTC = 03:43 on the 15th in Colombo).
    const captured = Date.UTC(2023, 10, 14, 18, 25)
    expect(dateKey('Asia/Colombo', new Date(captured))).toBe(YESTERDAY)
    seed('officer_approved', { dateKey: YESTERDAY }, pid(YESTERDAY))
    await doCheckIn(security(), { passId: pid(YESTERDAY), offlineCapturedAt: iso(captured) })
    expect(stored(pid(YESTERDAY))).toMatchObject({ status: 'checked_in', checkIn: { at: NOW_MS, offlineCapturedAt: iso(captured) } })
  })
  it('refuses a capture whose day (tenant timezone) differs from the pass day', async () => {
    seed('officer_approved')
    const lastNight = Date.UTC(2023, 10, 14, 18, 25) // the 14th in Colombo; the pass is for the 15th
    await rejects(doCheckIn(security(), { offlineCapturedAt: iso(lastNight) }), 'failed-precondition', 'offline-day-mismatch')
    expect(stored().status).toBe('officer_approved')
  })
})

describe('after check-in', () => {
  it('revokePass is blocked once the vehicle is checked in (officer and admin)', async () => {
    seed('officer_approved')
    await doCheckIn()
    for (const c of [officer(), admin()]) {
      await rejects(revokePass(w.deps, c, { passId: pid(), reasonCode: 'photo_not_fresh', expectedAttempt: 1 }), 'failed-precondition', 'already-checked-in')
    }
    expect(stored().status).toBe('checked_in')
  })
  it('the driver’s resolveVehicle reports checked_in', async () => {
    seed('officer_approved')
    await doCheckIn()
    expect(await resolveVehicle(w.deps, drv1(), { vehicleId: VID })).toMatchObject({ state: 'checked_in', pass: { status: 'checked_in', mine: true } })
  })
})

// ---- denyEntry ---------------------------------------------------------------------------------

const deny = (c: Caller = security(), over: Record<string, unknown> = {}) =>
  denyEntry(w.deps, c, { vehicleId: VID, reasonCode: 'driver_mismatch', gateId: 'main', requestId: R1, ...over })

describe('denyEntry', () => {
  it('records a gate event with the pass status read by the server, and never touches the pass', async () => {
    const before = structuredClone(seed('officer_approved'))
    expect(await deny(security(), { note: '  Different person  ' })).toEqual({ eventId: `den_${R1}`, at: NOW_MS, passStatus: 'officer_approved' })
    expect(w.gateEvents.get(`den_${R1}`)).toEqual({
      tenantId: 'T1', type: 'denied', vehicleId: VID, plateNo: 'WP LJ-4821', contractorId: 'C1', passId: pid(),
      passStatus: 'officer_approved', driverName: 'Dan Driver', dateKey: DAY, reasonCode: 'driver_mismatch', note: 'Different person',
      gateId: 'main', gateName: 'Main Gate', byUid: 'sec', byName: 'Sam Security', at: NOW_MS, requestId: R1,
    })
    expect(stored()).toEqual(before)
    expect(w.audits.at(-1)).toMatchObject({ action: 'gate.deny', targetType: 'gateEvent', targetId: `den_${R1}`, meta: { passStatus: 'officer_approved', reasonCode: 'driver_mismatch' } })
  })
  it('logs with passStatus null when there is no pass today', async () => {
    seed('officer_approved', { dateKey: YESTERDAY }, pid(YESTERDAY))
    await deny(security(), { reasonCode: 'not_approved' })
    expect(w.gateEvents.get(`den_${R1}`)).toMatchObject({ passId: null, passStatus: null, driverName: null })
  })
  it('only security', async () => {
    for (const c of [admin(), officer(), sup1(), drv1()]) await rejects(deny(c), 'permission-denied', 'forbidden')
    expect(w.gateEvents.size).toBe(0)
  })
  it('validates the reason; "other" needs a note of at least 3 characters', async () => {
    await rejects(deny(security(), { reasonCode: 'gps_unclear' }), 'invalid-argument', 'reason-invalid')
    await rejects(deny(security(), { reasonCode: 'other' }), 'invalid-argument', 'note-required')
    await rejects(deny(security(), { reasonCode: 'other', note: ' ab ' }), 'invalid-argument', 'note-required')
    await deny(security(), { reasonCode: 'other', note: 'Driver refused the search' })
    expect(w.gateEvents.get(`den_${R1}`)).toMatchObject({ reasonCode: 'other', note: 'Driver refused the search' })
  })
  it('is idempotent per requestId: a retry returns the first result and writes nothing', async () => {
    seed('submitted')
    const first = await deny()
    seed('officer_approved')
    w.deps.now = () => NOW + 60
    expect(await deny()).toEqual(first)
    expect(w.gateEvents.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'gate.deny')).toHaveLength(1)
  })
  it('another guard reusing the same requestId is refused', async () => {
    await deny()
    await rejects(deny(caller('sec2', 'security')), 'already-exists', 'request-conflict')
  })
  it('unknown, foreign and malformed vehicles are all "not found"', async () => {
    w.vehicles.set('veh_foreign000', { ...w.vehicles.get(VID)!, tenantId: 'T2' })
    await rejects(deny(security(), { vehicleId: 'veh_zzzzzzzzzz' }), 'not-found', 'vehicle-not-found')
    await rejects(deny(security(), { vehicleId: 'veh_foreign000' }), 'not-found', 'vehicle-not-found')
    await rejects(deny(security(), { vehicleId: 'nope' }), 'invalid-argument', 'invalid-input')
  })
  it('the gate and requestId are validated', async () => {
    await rejects(deny(security(), { gateId: 'side' }), 'invalid-argument', 'gate-invalid')
    await rejects(deny(security(), { requestId: '123' }), 'invalid-argument', 'invalid-input')
  })
})

// ---- updateTenantSettings: gates ---------------------------------------------------------------

describe('updateTenantSettings: gates', () => {
  const save = (c: Caller, gates: unknown) => updateTenantSettings(w.deps, c, { gates })
  it('admin saves 1 to 10 gates; other settings are kept', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', rejectionReasons: [{ id: 'a', label: 'Aaa' }] })
    await save(admin(), [{ id: 'main', name: ' Main Gate ' }, { id: 'weighbridge', name: 'Weighbridge' }])
    expect(w.tenants.get('T1')).toMatchObject({
      timezone: 'Asia/Colombo',
      rejectionReasons: [{ id: 'a', label: 'Aaa' }],
      gates: [{ id: 'main', name: 'Main Gate' }, { id: 'weighbridge', name: 'Weighbridge' }],
    })
    expect(w.audits.at(-1)).toMatchObject({ action: 'tenant.settings.update', meta: { gates: 2 } })
  })
  it('at least one gate remains, at most 10, names 2-40 characters, slug ids, unique', async () => {
    await rejects(save(admin(), []), 'invalid-argument', 'invalid-input')
    await rejects(save(admin(), Array.from({ length: 11 }, (_, i) => ({ id: `g${i}`, name: `Gate ${i}` }))), 'invalid-argument', 'invalid-input')
    await rejects(save(admin(), [{ id: 'main', name: 'M' }]), 'invalid-argument', 'invalid-input')
    await rejects(save(admin(), [{ id: 'main', name: 'x'.repeat(41) }]), 'invalid-argument', 'invalid-input')
    await rejects(save(admin(), [{ id: 'Main Gate', name: 'Main' }]), 'invalid-argument', 'invalid-input')
    await rejects(save(admin(), [{ id: 'main', name: 'Main' }, { id: 'main', name: 'Other' }]), 'invalid-argument', 'invalid-input')
  })
  it('only admins', async () => {
    for (const c of [officer(), security(), sup1()]) await rejects(save(c, [{ id: 'main', name: 'Main' }]), 'permission-denied', 'forbidden')
  })
})
