import { beforeEach, describe, expect, it } from 'vitest'
import { checkIn, denyEntry } from './gate.js'
import { resolveVehicle, submitPass } from './passes.js'
import { isPinRole, SESSION_MAX_AGE_SECONDS, sessionExpired } from './session.js'
import { caller, makeWorld, NOW, rejects, userDoc, type World } from './test-utils.js'

const VID = 'veh_aaaaaaaaaa'
const R = '11111111-1111-4111-8111-111111111111'
const DAY = 24 * 3600

let w: World
beforeEach(() => {
  w = makeWorld()
  w.users.set('sec', userDoc({ role: 'security', contractorId: null, email: null, phone: null, loginType: 'pin' }))
  w.vehicles.set(VID, {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: ['drv1'], status: 'active',
  })
})

const driverAt = (age: number) => caller('drv1', 'driver', 'C1', { authTime: NOW - age })
const guardAt = (age: number) => caller('sec', 'security', null, { authTime: NOW - age })

const submitInput = {
  vehicleId: VID,
  attempt: 1,
  checklist: [],
  extraCount: 0,
  captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:00:00.000Z', dashcam: '2023-11-14T22:00:00.000Z' } },
}
const checkInInput = { passId: `${VID}_20231115`, expectedAttempt: 1, gateId: 'main', requestId: R }
const denyInput = { vehicleId: VID, reasonCode: 'other', note: 'a long enough note', gateId: 'main', requestId: R }

describe('session limits (module constants)', () => {
  it('driver 90 days, security and yard officer 16 hours, nobody else', () => {
    expect(SESSION_MAX_AGE_SECONDS).toEqual({ driver: 90 * DAY, security: 16 * 3600, yard: 16 * 3600 })
    expect(sessionExpired('yard', NOW - 16 * 3600 - 1, NOW)).toBe(true)
    expect(sessionExpired('yard', NOW - 16 * 3600, NOW)).toBe(false)
    expect(sessionExpired('driver', NOW - 90 * DAY, NOW)).toBe(false)
    expect(sessionExpired('driver', NOW - 90 * DAY - 1, NOW)).toBe(true)
    expect(sessionExpired('security', NOW - 16 * 3600 - 1, NOW)).toBe(true)
    for (const role of ['admin', 'officer', 'supervisor'] as const) expect(sessionExpired(role, 0, NOW)).toBe(false)
    expect(['driver', 'security', 'yard'].every(isPinRole)).toBe(true)
    expect(['admin', 'officer', 'supervisor', 'safety', 'platform'].some(isPinRole)).toBe(false)
  })
})

describe('a driver token older than 90 days gets session-expired', () => {
  const old = driverAt(90 * DAY + 60)
  it('resolveVehicle', () => rejects(resolveVehicle(w.deps, old, { vehicleId: VID }), 'unauthenticated', 'session-expired'))
  it('submitPass', () => rejects(submitPass(w.deps, old, submitInput), 'unauthenticated', 'session-expired'))
  it('a younger token works', async () => {
    expect((await resolveVehicle(w.deps, driverAt(89 * DAY), { vehicleId: VID })).state).toBe('can_submit')
  })
})

describe('a security token older than 16 hours gets session-expired', () => {
  const old = guardAt(16 * 3600 + 60)
  it('checkIn', () => rejects(checkIn(w.deps, old, checkInInput), 'unauthenticated', 'session-expired'))
  it('denyEntry', () => rejects(denyEntry(w.deps, old, denyInput), 'unauthenticated', 'session-expired'))
  it('a younger token gets past the session check', async () => {
    const young = guardAt(15 * 3600)
    // No pass exists: the call is refused for that, not for the session.
    await expect(checkIn(w.deps, young, checkInInput)).rejects.not.toMatchObject({ details: { reason: 'session-expired' } })
    expect((await denyEntry(w.deps, young, denyInput)).eventId).toBe(`den_${R}`)
  })
})

describe('a reissued PIN refuses sessions that signed in before it', () => {
  it('sessionsRevokedAt', async () => {
    w.users.set('sec', { ...(w.users.get('sec') as NonNullable<ReturnType<typeof w.users.get>>), sessionsRevokedAt: NOW - 5 })
    await rejects(denyEntry(w.deps, guardAt(10), denyInput), 'unauthenticated', 'session-expired')
    expect((await denyEntry(w.deps, guardAt(5), denyInput)).eventId).toBe(`den_${R}`)
  })
})
