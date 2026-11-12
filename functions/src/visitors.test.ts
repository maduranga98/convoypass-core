import { beforeEach, describe, expect, it } from 'vitest'
import { checkInVisitorPass, checkOutVisitorPass, issueVisitorPass, lookupVisitorPass, revokeVisitorPass, updateVisitor, updateVisitorSettings, visitorPhone } from './visitors.js'
import { expireVisitorPasses } from './visitorExpiry.js'
import { NOW, admin, caller, makeWorld, rejects, sup1, type World } from './test-utils.js'
import { makeVisitorWorld, NOW_MS, type VisitorWorld } from './visitor-test-utils.js'

const BASE = 'https://app.example.com'
const sec = () => caller('sec', 'security')
const REQ = '3f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'
const REQ2 = '4f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'
const idOf = (n: number, prefix: 'vsp' | 'vst') => `${prefix}_${String(n).padStart(10, '0')}`

let w: World
let vw: VisitorWorld
beforeEach(() => {
  w = makeWorld()
  vw = makeVisitorWorld(w)
})

const input = (n = 1, over: Record<string, unknown> = {}) => ({
  passId: idOf(n, 'vsp'),
  visitorId: idOf(n, 'vst'),
  visitor: { fullName: 'Nimal Perera', phone: '0771234567', idNumber: '851234567V', organization: 'Audit Co' },
  hostName: 'Finance',
  purposeOfVisit: 'Quarterly audit',
  ...over,
})
const issue = (c = admin(), over: Record<string, unknown> = {}, n = 1) => issueVisitorPass(w.deps, vw.port, c, input(n, over), BASE)
const codeOf = async (n = 1) => vw.passes.get(idOf(n, 'vsp'))!.passCode

describe('issueVisitorPass', () => {
  it('creates the visitor and the pass, counts it, audits and returns the code and QR payload', async () => {
    const res = await issue()
    expect(res).toMatchObject({ passId: idOf(1, 'vsp'), created: true, used: 1, cap: null, siteId: 'main', siteName: 'Main Gate' })
    expect(res.passCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(res.qrPayload).toBe(`${BASE}/vp/${res.passCode}`)
    expect(vw.visitors.get(idOf(1, 'vst'))).toMatchObject({ tenantId: 'T1', fullName: 'Nimal Perera', phone: '94771234567', idKey: '851234567V', organization: 'Audit Co', createdBy: 'admin' })
    expect(vw.passes.get(idOf(1, 'vsp'))).toMatchObject({
      tenantId: 'T1', visitorName: 'Nimal Perera', hostName: 'Finance', status: 'active', month: '202311', maxDwellMinutes: 480,
      issuedBy: { uid: 'admin', role: 'admin' }, checkInAt: null, dwellWarning: false,
    })
    expect(vw.usage.get('T1_202311')).toBe(1)
    expect(w.audits.map((a) => a.action)).toEqual(['visitor.create', 'visitorPass.issue'])
  })

  it('defaults to one day (today in the company timezone) and honours the company default and explicit dates', async () => {
    await issue()
    const p = vw.passes.get(idOf(1, 'vsp'))!
    expect(p.validUntil - p.validFrom).toBe(86_400_000 - 1)
    await updateVisitorSettings(w.deps, vw.port, admin(), { defaultValidDays: 3 })
    await issue(admin(), {}, 2)
    const p2 = vw.passes.get(idOf(2, 'vsp'))!
    expect(p2.validUntil - p2.validFrom).toBe(3 * 86_400_000 - 1)
    await issue(admin(), { validFrom: '2023-11-20', validUntil: '2023-11-21' }, 3)
    expect(vw.passes.get(idOf(3, 'vsp'))!.validFrom).toBe(Date.parse('2023-11-19T18:30:00Z'))
  })

  it('is idempotent: a retry returns the same pass and counts nothing twice', async () => {
    const first = await issue()
    const again = await issue()
    expect(again).toMatchObject({ passCode: first.passCode, created: false, used: 1 })
    expect(vw.usage.get('T1_202311')).toBe(1)
    expect(vw.passes.size).toBe(1)
    expect(w.audits.filter((a) => a.action === 'visitorPass.issue')).toHaveLength(1)
  })

  it('refuses a pass id that someone else already used', async () => {
    await issue(admin())
    await rejects(issue(sup1()), 'already-exists', 'request-conflict')
  })

  it('reuses the visitor record of a returning visitor (keeps who created them, follows the new details)', async () => {
    await issue(admin(), {}, 1)
    await issueVisitorPass(w.deps, vw.port, sup1(), { ...input(2), visitorId: idOf(1, 'vst'), visitor: { fullName: 'Nimal P. Perera', phone: '+94771234567' } }, BASE)
    expect(vw.visitors.size).toBe(1)
    expect(vw.visitors.get(idOf(1, 'vst'))).toMatchObject({ fullName: 'Nimal P. Perera', createdBy: 'admin', idNumber: null })
    expect(vw.passes.get(idOf(2, 'vsp'))).toMatchObject({ visitorId: idOf(1, 'vst'), visitorName: 'Nimal P. Perera', issuedBy: { uid: 'sup1' } })
    expect(w.audits.filter((a) => a.action === 'visitor.create')).toHaveLength(1)
  })

  it("never reuses another company's visitor record", async () => {
    vw.visitors.set(idOf(1, 'vst'), { tenantId: 'T2', fullName: 'X', phone: '1', idNumber: null, idKey: null, organization: null, photoPath: null, createdAt: 1, createdBy: 'a', updatedAt: 1 })
    await rejects(issue(), 'not-found', 'visitor-not-found')
  })

  it('gives every pass of a company a different code, and retries a collision with a new code', async () => {
    const codes = new Set<string>()
    for (let n = 1; n <= 30; n++) codes.add((await issue(admin(), {}, n)).passCode)
    expect(codes.size).toBe(30)
    // A taken code is skipped: the guard of the company already holds it.
    vw.codes.set('T1_AAAAAAAA', 'other')
    const res = await issue(admin(), {}, 31)
    expect(res.passCode).not.toBe('AAAAAAAA')
  })

  it('only the admin and supervisors issue; Security, Safety, Yard, officers and drivers cannot', async () => {
    for (const c of [sec(), caller('safe1', 'safety'), caller('yard1', 'yard'), caller('officer', 'officer'), caller('drv1', 'driver', 'C1')]) {
      await rejects(issue(c), 'permission-denied', 'forbidden')
    }
    await issue(sup1())
    expect(vw.passes.get(idOf(1, 'vsp'))!.issuedBy.role).toBe('supervisor')
  })

  it('validates its input: names, purpose, ids, phone, dates, site', async () => {
    await rejects(issue(admin(), { purposeOfVisit: 'x' }), 'invalid-argument', 'invalid-input')
    await rejects(issue(admin(), { passId: 'pass_1' }), 'invalid-argument', 'invalid-input')
    await rejects(issue(admin(), { visitor: { fullName: 'A', phone: '0771234567' } }), 'invalid-argument', 'invalid-input')
    await rejects(issue(admin(), { visitor: { fullName: 'Ann Lee', phone: '12' } }), 'invalid-argument', 'invalid-input')
    await rejects(issue(admin(), { visitor: { fullName: 'Ann Lee', phone: 'call me' } }), 'invalid-argument', 'invalid-input')
    await rejects(issue(admin(), { validFrom: '2023-11-01' }), 'invalid-argument', 'invalid-window')
    await rejects(issue(admin(), { validFrom: '2023-11-20', validUntil: '2023-11-19' }), 'invalid-argument', 'invalid-window')
    await rejects(issue(admin(), { siteId: 'nowhere' }), 'invalid-argument', 'gate-invalid')
    expect(vw.passes.size).toBe(0)
    expect(vw.usage.size).toBe(0)
  })

  it('keeps a foreign number as digits and normalises a Sri Lankan one', () => {
    expect(visitorPhone('077 123 4567')).toBe('94771234567')
    expect(visitorPhone('+44 20 7946 0958')).toBe('+442079460958')
    expect(visitorPhone('abc')).toBeNull()
  })

  it('verifies an uploaded photo (exists, JPEG, sane size) before using it', async () => {
    await rejects(issue(admin(), { hasPhoto: true }), 'failed-precondition', 'photo-missing')
    const path = `tenants/T1/visitors/${idOf(1, 'vst')}.jpg`
    w.files.set(path, { contentType: 'image/png', size: 5000, head: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), timeCreated: NOW_MS })
    await rejects(issue(admin(), { hasPhoto: true }), 'failed-precondition', 'evidence-invalid')
    w.files.set(path, { contentType: 'image/jpeg', size: 20_000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), timeCreated: NOW_MS })
    await issue(admin(), { hasPhoto: true })
    expect(vw.visitors.get(idOf(1, 'vst'))!.photoPath).toBe(path)
    expect(vw.passes.get(idOf(1, 'vsp'))!.photoPath).toBe(path)
  })
})

describe('the plan cap', () => {
  beforeEach(() => {
    w.tenants.set('T1', { ...w.tenants.get('T1'), plan: 'starter' })
  })

  it('lets Starter issue 20 passes a month and refuses the 21st without writing anything', async () => {
    for (let n = 1; n <= 20; n++) await issue(admin(), {}, n)
    expect(vw.usage.get('T1_202311')).toBe(20)
    const res = issue(admin(), {}, 21)
    await rejects(res, 'resource-exhausted', 'plan-limit-reached')
    await expect(res).rejects.toMatchObject({ details: { used: 20, cap: 20 } })
    expect(vw.passes.size).toBe(20)
    expect(vw.visitors.has(idOf(21, 'vst'))).toBe(false)
    expect(vw.usage.get('T1_202311')).toBe(20)
  })

  it('reports used and cap with every issue', async () => {
    expect(await issue(admin(), {}, 1)).toMatchObject({ used: 1, cap: 20 })
    expect(await issue(admin(), {}, 2)).toMatchObject({ used: 2, cap: 20 })
  })

  it('still answers a retry of a pass issued before the cap was reached', async () => {
    for (let n = 1; n <= 20; n++) await issue(admin(), {}, n)
    await expect(issue(admin(), {}, 20)).resolves.toMatchObject({ created: false, used: 20, cap: 20 })
  })

  it('starts a new count in a new month (company timezone)', async () => {
    vw.usage.set('T1_202310', 20)
    await expect(issue(admin(), {}, 1)).resolves.toMatchObject({ used: 1 })
  })

  it('does not cap Growth and Compliance, or a company without a plan', async () => {
    for (const plan of ['growth', 'compliance', undefined]) {
      w.tenants.set('T1', { ...w.tenants.get('T1'), plan })
      vw.usage.set('T1_202311', 500)
      await expect(issue(admin(), {}, 40)).resolves.toMatchObject({ cap: null })
      vw.passes.clear()
      vw.visitors.clear()
    }
  })

  it('counts per company', async () => {
    vw.usage.set('T2_202311', 20)
    await expect(issue(admin(), {}, 1)).resolves.toMatchObject({ used: 1 })
  })
})

describe('checkInVisitorPass', () => {
  const checkIn = (c = sec(), over: Record<string, unknown> = {}) => checkInVisitorPass(w.deps, vw.port, c, { code: undefined, siteId: 'main', requestId: REQ, ...over })
  beforeEach(async () => {
    await issue()
  })

  it('checks a visitor in by code, with the guard from the token and the time from the server', async () => {
    const code = await codeOf()
    const res = await checkIn(sec(), { code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` })
    expect(res).toMatchObject({ passId: idOf(1, 'vsp'), visitorName: 'Nimal Perera', at: NOW_MS, recorded: true })
    expect(vw.passes.get(idOf(1, 'vsp'))).toMatchObject({ status: 'checked_in', checkInAt: NOW_MS, checkInBy: { uid: 'sec' }, checkInRequestId: REQ })
    expect(w.audits.at(-1)).toMatchObject({ action: 'visitorPass.checkIn', targetId: idOf(1, 'vsp') })
  })

  it('also finds the pass by its id', async () => {
    await expect(checkIn(sec(), { passId: idOf(1, 'vsp') })).resolves.toMatchObject({ recorded: true })
  })

  it('is idempotent on the request id, and a second guard sees who checked the visitor in', async () => {
    const code = await codeOf()
    await checkIn(sec(), { code })
    await expect(checkIn(sec(), { code })).resolves.toMatchObject({ recorded: true })
    expect(w.audits.filter((a) => a.action === 'visitorPass.checkIn')).toHaveLength(1)
    const other = checkIn(caller('sec', 'security'), { code, requestId: REQ2 })
    await rejects(other, 'already-exists', 'pass-already-checked-in')
    await expect(other).rejects.toMatchObject({ details: { byName: 'Name', at: NOW_MS } })
  })

  it('refuses a revoked pass, an expired one, one that is not valid yet and one for another site, each with its own reason', async () => {
    const code = await codeOf()
    const id = idOf(1, 'vsp')
    const base = vw.passes.get(id)!
    vw.passes.set(id, { ...base, validUntil: NOW_MS - 1 })
    await rejects(checkIn(sec(), { code }), 'failed-precondition', 'pass-expired')
    vw.passes.set(id, { ...base, status: 'expired' })
    await rejects(checkIn(sec(), { code }), 'failed-precondition', 'pass-expired')
    vw.passes.set(id, { ...base, validFrom: NOW_MS + 60_000 })
    await rejects(checkIn(sec(), { code }), 'failed-precondition', 'pass-not-yet-valid')
    vw.passes.set(id, { ...base, status: 'revoked', revokeReason: 'cancelled' })
    await rejects(checkIn(sec(), { code }), 'failed-precondition', 'pass-revoked')
    vw.passes.set(id, { ...base, status: 'checked_out' })
    await rejects(checkIn(sec(), { code }), 'failed-precondition', 'pass-already-checked-out')
    vw.passes.set(id, { ...base, siteId: 'back', siteName: 'Back Gate' })
    w.tenants.set('T1', { ...w.tenants.get('T1'), gates: [{ id: 'main', name: 'Main Gate' }, { id: 'back', name: 'Back Gate' }] })
    const wrong = checkIn(sec(), { code, siteId: 'main' })
    await rejects(wrong, 'failed-precondition', 'wrong-site')
    await expect(wrong).rejects.toMatchObject({ details: { siteName: 'Back Gate' } })
    expect(vw.passes.get(id)!.status).toBe('active')
  })

  it('answers every unknown, malformed or foreign code the same way', async () => {
    const code = await codeOf()
    await rejects(checkIn(sec(), { code: 'ZZZZZZZZ' }), 'not-found', 'visitor-pass-not-found')
    await rejects(checkIn(sec(), { code: 'nonsense' }), 'not-found', 'visitor-pass-not-found')
    await rejects(checkIn(caller('x', 'security', null, { tenantId: 'T2' }), { code }), 'permission-denied')
    await rejects(checkIn(sec(), { code: undefined }), 'invalid-argument', 'invalid-input')
    await rejects(checkIn(sec(), { code, passId: idOf(1, 'vsp') }), 'invalid-argument', 'invalid-input')
    await rejects(checkIn(sec(), { code, siteId: 'nowhere' }), 'invalid-argument', 'gate-invalid')
  })

  it("never lets another company's guard use a pass", async () => {
    w.users.set('sec2', { ...w.users.get('sec')!, tenantId: 'T2' })
    await rejects(checkIn(caller('sec2', 'security', null, { tenantId: 'T2' }), { passId: idOf(1, 'vsp') }), 'not-found', 'visitor-pass-not-found')
  })

  it('is for Security only', async () => {
    const code = await codeOf()
    for (const c of [admin(), sup1(), caller('safe1', 'safety'), caller('yard1', 'yard'), caller('drv1', 'driver', 'C1')]) {
      await rejects(checkIn(c, { code }), 'permission-denied', 'forbidden')
    }
  })
})

describe('checkOutVisitorPass', () => {
  const checkOut = (c = sec(), over: Record<string, unknown> = {}) => checkOutVisitorPass(w.deps, vw.port, c, { passId: idOf(1, 'vsp'), requestId: REQ2, ...over })
  beforeEach(async () => {
    await issue()
    await checkInVisitorPass(w.deps, vw.port, sec(), { code: await codeOf(), siteId: 'main', requestId: REQ })
  })

  it('checks a checked-in visitor out', async () => {
    await expect(checkOut()).resolves.toMatchObject({ passId: idOf(1, 'vsp'), at: NOW_MS, recorded: true })
    expect(vw.passes.get(idOf(1, 'vsp'))).toMatchObject({ status: 'checked_out', checkOutAt: NOW_MS, checkOutBy: { uid: 'sec' }, checkOutRequestId: REQ2 })
  })

  it('is idempotent, and refuses a different request on a pass already out', async () => {
    await checkOut()
    await expect(checkOut()).resolves.toMatchObject({ recorded: true })
    expect(w.audits.filter((a) => a.action === 'visitorPass.checkOut')).toHaveLength(1)
    await rejects(checkOut(sec(), { requestId: REQ }), 'failed-precondition', 'pass-already-checked-out')
  })

  it('refuses a pass that is not checked in, and another company', async () => {
    await issue(admin(), {}, 2)
    await rejects(checkOut(sec(), { passId: idOf(2, 'vsp') }), 'failed-precondition', 'pass-not-checked-in')
    w.users.set('sec2', { ...w.users.get('sec')!, tenantId: 'T2' })
    await rejects(checkOut(caller('sec2', 'security', null, { tenantId: 'T2' })), 'not-found', 'visitor-pass-not-found')
  })

  it('is always accepted after the validity end or the dwell limit (a visitor must be able to leave)', async () => {
    const id = idOf(1, 'vsp')
    vw.passes.set(id, { ...vw.passes.get(id)!, validUntil: NOW_MS - 1, dwellWarning: true })
    await expect(checkOut()).resolves.toMatchObject({ recorded: true })
  })

  it('is for Security only', async () => {
    for (const c of [admin(), sup1(), caller('safe1', 'safety'), caller('yard1', 'yard')]) await rejects(checkOut(c), 'permission-denied', 'forbidden')
  })
})

describe('revokeVisitorPass', () => {
  const revoke = (c = admin(), over: Record<string, unknown> = {}) => revokeVisitorPass(w.deps, vw.port, c, { passId: idOf(1, 'vsp'), reason: 'Visit cancelled', ...over })
  beforeEach(async () => {
    await issue()
  })

  it('revokes an active pass; the pass can no longer be used', async () => {
    await revoke(sup1())
    expect(vw.passes.get(idOf(1, 'vsp'))).toMatchObject({ status: 'revoked', revokedBy: { uid: 'sup1' }, revokeReason: 'Visit cancelled', revokedAt: NOW_MS })
    await rejects(checkInVisitorPass(w.deps, vw.port, sec(), { passId: idOf(1, 'vsp'), siteId: 'main', requestId: REQ }), 'failed-precondition', 'pass-revoked')
  })

  it('is idempotent, and refuses a pass that is already inside, out or expired', async () => {
    await revoke()
    await revoke()
    expect(w.audits.filter((a) => a.action === 'visitorPass.revoke')).toHaveLength(1)
    const id = idOf(1, 'vsp')
    for (const status of ['checked_in', 'checked_out', 'expired'] as const) {
      vw.passes.set(id, { ...vw.passes.get(id)!, status })
      await rejects(revoke(), 'failed-precondition', 'pass-not-active')
    }
  })

  it('is for the admin and supervisors', async () => {
    for (const c of [sec(), caller('safe1', 'safety'), caller('yard1', 'yard')]) await rejects(revoke(c), 'permission-denied', 'forbidden')
  })
})

describe('lookupVisitorPass', () => {
  it('shows what the gate needs and never the phone or the id number', async () => {
    await issue()
    const view = await lookupVisitorPass(w.deps, vw.port, sec(), { code: await codeOf() })
    expect(view).toMatchObject({ visitorName: 'Nimal Perera', hostName: 'Finance', purposeOfVisit: 'Quarterly audit', status: 'active', entry: 'ok', overstay: false })
    expect(JSON.stringify(view)).not.toMatch(/94771234567|851234567V/)
    for (const c of [admin(), sup1(), caller('safe1', 'safety')]) await expect(lookupVisitorPass(w.deps, vw.port, c, { passId: idOf(1, 'vsp') })).resolves.toBeTruthy()
    await rejects(lookupVisitorPass(w.deps, vw.port, caller('yard1', 'yard'), { passId: idOf(1, 'vsp') }), 'permission-denied', 'forbidden')
  })

  it('reads a pass past its last day as expired before the schedule has run', async () => {
    await issue()
    const id = idOf(1, 'vsp')
    vw.passes.set(id, { ...vw.passes.get(id)!, validUntil: NOW_MS - 1 })
    await expect(lookupVisitorPass(w.deps, vw.port, sec(), { passId: id })).resolves.toMatchObject({ status: 'expired', entry: 'expired' })
  })

  it('does not tell a foreign pass from a missing one', async () => {
    await issue()
    w.users.set('sec2', { ...w.users.get('sec')!, tenantId: 'T2' })
    await rejects(lookupVisitorPass(w.deps, vw.port, caller('sec2', 'security', null, { tenantId: 'T2' }), { code: await codeOf() }), 'not-found', 'visitor-pass-not-found')
  })
})

describe('updateVisitor', () => {
  it('edits the record and the copy on the visitor’s live passes only', async () => {
    await issue(admin(), {}, 1)
    await issue(admin(), { visitorId: idOf(1, 'vst') }, 2)
    vw.passes.set(idOf(2, 'vsp'), { ...vw.passes.get(idOf(2, 'vsp'))!, status: 'checked_out' })
    await updateVisitor(w.deps, vw.port, sup1(), { visitorId: idOf(1, 'vst'), fullName: 'Nimal K. Perera', idNumber: '' })
    expect(vw.visitors.get(idOf(1, 'vst'))).toMatchObject({ fullName: 'Nimal K. Perera', idNumber: null, idKey: null })
    expect(vw.passes.get(idOf(1, 'vsp'))!.visitorName).toBe('Nimal K. Perera')
    expect(vw.passes.get(idOf(2, 'vsp'))!.visitorName).toBe('Nimal Perera')
    expect(w.audits.at(-1)).toMatchObject({ action: 'visitor.update', targetType: 'visitor' })
  })

  it('refuses empty edits, foreign visitors and other roles', async () => {
    await issue()
    await rejects(updateVisitor(w.deps, vw.port, admin(), { visitorId: idOf(1, 'vst') }), 'invalid-argument', 'invalid-input')
    await rejects(updateVisitor(w.deps, vw.port, admin(), { visitorId: idOf(9, 'vst'), fullName: 'Someone' }), 'not-found', 'visitor-not-found')
    await rejects(updateVisitor(w.deps, vw.port, sec(), { visitorId: idOf(1, 'vst'), fullName: 'Someone' }), 'permission-denied', 'forbidden')
    await rejects(updateVisitor(w.deps, vw.port, caller('admin_t2', 'admin', null, { tenantId: 'T2' }), { visitorId: idOf(1, 'vst'), fullName: 'Someone' }), 'not-found', 'visitor-not-found')
  })
})

describe('updateVisitorSettings', () => {
  it('is the admin’s, validates its ranges and applies to the next pass', async () => {
    await updateVisitorSettings(w.deps, vw.port, admin(), { maxDwellMinutes: 120 })
    expect(w.tenants.get('T1')!.visitorSettings).toEqual({ maxDwellMinutes: 120 })
    await issue()
    expect(vw.passes.get(idOf(1, 'vsp'))!.maxDwellMinutes).toBe(120)
    await rejects(updateVisitorSettings(w.deps, vw.port, admin(), { maxDwellMinutes: 5 }), 'invalid-argument', 'invalid-input')
    await rejects(updateVisitorSettings(w.deps, vw.port, admin(), { defaultValidDays: 31 }), 'invalid-argument', 'invalid-input')
    await rejects(updateVisitorSettings(w.deps, vw.port, admin(), {}), 'invalid-argument', 'invalid-input')
    await rejects(updateVisitorSettings(w.deps, vw.port, sup1(), { maxDwellMinutes: 120 }), 'permission-denied', 'forbidden')
  })
})

describe('expireVisitorPasses (schedule)', () => {
  it('expires active passes past their last day, flags long stays once, closes nothing and is idempotent', async () => {
    await issue(admin(), {}, 1) // will expire
    await issue(admin(), {}, 2) // inside, over its limit
    await issue(admin(), {}, 3) // inside, within its limit
    await issue(admin(), {}, 4) // still valid
    const set = (n: number, patch: Record<string, unknown>) => vw.passes.set(idOf(n, 'vsp'), { ...vw.passes.get(idOf(n, 'vsp'))!, ...patch } as never)
    set(1, { validUntil: NOW_MS - 1 })
    set(2, { status: 'checked_in', checkInAt: NOW_MS - 10 * 3_600_000, maxDwellMinutes: 480 })
    set(3, { status: 'checked_in', checkInAt: NOW_MS - 3_600_000, maxDwellMinutes: 480 })
    const first = await expireVisitorPasses(vw.port, NOW_MS)
    expect(first).toMatchObject({ expired: 1, flagged: 1, failedTenants: 0 })
    expect(vw.passes.get(idOf(1, 'vsp'))).toMatchObject({ status: 'expired', expiredAt: NOW_MS })
    expect(vw.passes.get(idOf(2, 'vsp'))).toMatchObject({ status: 'checked_in', dwellWarning: true, dwellWarningAt: NOW_MS })
    expect(vw.passes.get(idOf(3, 'vsp'))).toMatchObject({ status: 'checked_in', dwellWarning: false })
    expect(vw.passes.get(idOf(4, 'vsp'))!.status).toBe('active')
    expect(await expireVisitorPasses(vw.port, NOW_MS)).toMatchObject({ expired: 0, flagged: 0 })
    expect(w.audits.filter((a) => a.actorRole === 'system').map((a) => a.action).sort()).toEqual(['visitorPass.dwellWarning', 'visitorPass.expire'])
  })

  it('does not expire a pass whose visitor is inside, even past its last day', async () => {
    await issue()
    vw.passes.set(idOf(1, 'vsp'), { ...vw.passes.get(idOf(1, 'vsp'))!, status: 'checked_in', checkInAt: NOW_MS - 60_000, validUntil: NOW_MS - 1 })
    await expireVisitorPasses(vw.port, NOW_MS)
    expect(vw.passes.get(idOf(1, 'vsp'))!.status).toBe('checked_in')
  })
})

it('uses the shared test clock', () => {
  expect(NOW_MS).toBe(NOW * 1000)
})
