// Runs the real Firestore adapter for visitor passes (issue with the usage counter and code guard, check-in/out, revoke,
// returning visitor, expiry and the overstay flag) against the emulator. Without FIRESTORE_EMULATOR_HOST the file is skipped.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Deps } from './core.js'
import { dataPort } from './ports.js'
import { caller, makeWorld, NOW, rejects, userDoc } from './test-utils.js'
import { expireVisitorPasses } from './visitorExpiry.js'
import { visitorPort } from './visitorsPort.js'
import { checkInVisitorPass, checkOutVisitorPass, issueVisitorPass, revokeVisitorPass, updateVisitor } from './visitors.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const NOW_MS = NOW * 1000
const REQ = '3f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'
const REQ2 = '4f1d6c1e-6a52-4b6a-9d0e-0a1b2c3d4e5f'
const id = (n: number, p: 'vsp' | 'vst') => `${p}_${String(n).padStart(10, '0')}`

describe.skipIf(!emulator)('visitor passes on the Firestore emulator', () => {
  let db: FirebaseFirestore.Firestore
  let deps: Deps
  const admin = () => caller('admin', 'admin')
  const sec = () => caller('sec', 'security')
  const port = () => visitorPort()
  const get = async (path: string) => (await db.doc(path).get()).data() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const issue = (n = 1, over: Record<string, unknown> = {}, c = admin()) =>
    issueVisitorPass(deps, port(), c, { passId: id(n, 'vsp'), visitorId: id(n, 'vst'), visitor: { fullName: 'Ann Lee', phone: '0771234567', idNumber: '851234567V' }, purposeOfVisit: 'Audit', hostName: 'Finance', ...over }, 'https://app.example.com')

  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })

  beforeEach(async () => {
    for (const c of ['visitors', 'visitorPasses', 'visitorPassUsage', 'visitorPassCodes', 'auditLog', 'users', 'tenants']) await db.recursiveDelete(db.collection(c))
    deps = { ...makeWorld().deps, data: dataPort() }
    await db.doc('tenants/T1').set({ timezone: 'Asia/Colombo' })
    await db.doc('users/admin').set(userDoc({ role: 'admin', contractorId: null, name: 'Ada Admin', email: 'a@x.com', phone: null }))
    await db.doc('users/sec').set(userDoc({ role: 'security', contractorId: null, name: 'Sam', email: 'sec@x.com', phone: null }))
  })

  it('issues: creates visitor, pass, code guard, usage counter and audit entries together, with real Timestamps', async () => {
    const res = await issue()
    expect(res).toMatchObject({ created: true, used: 1, cap: null })
    const pass = await get(`visitorPasses/${id(1, 'vsp')}`)
    expect(pass).toMatchObject({ tenantId: 'T1', visitorName: 'Ann Lee', passCode: res.passCode, status: 'active', month: '202311', checkInAt: null })
    expect(pass.issuedAt.toMillis()).toBe(NOW_MS)
    expect(pass.validUntil.toMillis() - pass.validFrom.toMillis()).toBe(86_400_000 - 1)
    expect(await get(`visitors/${id(1, 'vst')}`)).toMatchObject({ tenantId: 'T1', fullName: 'Ann Lee', idKey: '851234567V', phone: '94771234567' })
    expect(await get(`visitorPassUsage/T1_202311`)).toMatchObject({ tenantId: 'T1', count: 1, yearMonth: '202311' })
    expect(await get(`visitorPassCodes/T1_${res.passCode}`)).toMatchObject({ passId: id(1, 'vsp') })
    expect((await db.collection('auditLog').where('action', 'in', ['visitor.create', 'visitorPass.issue']).get()).size).toBe(2)
  })

  it('enforces the Starter cap atomically: 25 concurrent issues create exactly 20 passes', async () => {
    await db.doc('tenants/T1').set({ timezone: 'Asia/Colombo', plan: 'starter' })
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => issue(i + 1)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20)
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason?.details?.reason === 'plan-limit-reached')).toBe(true)
    expect((await db.collection('visitorPasses').get()).size).toBe(20)
    expect(await get('visitorPassUsage/T1_202311')).toMatchObject({ count: 20 })
  })

  it('a retry of the same issue counts nothing and returns the stored code', async () => {
    const a = await issue()
    const b = await issue()
    expect(b).toMatchObject({ created: false, passCode: a.passCode, used: 1 })
    expect(await get('visitorPassUsage/T1_202311')).toMatchObject({ count: 1 })
    expect((await db.collection('visitorPasses').get()).size).toBe(1)
  })

  it('a returning visitor keeps who created them; their live passes follow an edit', async () => {
    await issue(1)
    await issueVisitorPass(deps, port(), caller('admin', 'admin'), { passId: id(2, 'vsp'), visitorId: id(1, 'vst'), visitor: { fullName: 'Ann M. Lee', phone: '0771234567' }, purposeOfVisit: 'Follow-up' }, 'https://app.example.com')
    expect((await db.collection('visitors').get()).size).toBe(1)
    expect(await get(`visitors/${id(1, 'vst')}`)).toMatchObject({ fullName: 'Ann M. Lee', createdBy: 'admin' })
    await updateVisitor(deps, port(), admin(), { visitorId: id(1, 'vst'), organization: 'Audit Co' })
    expect(await get(`visitorPasses/${id(1, 'vsp')}`)).toMatchObject({ visitorOrganization: 'Audit Co' })
    expect(await get(`visitorPasses/${id(2, 'vsp')}`)).toMatchObject({ visitorOrganization: 'Audit Co' })
  })

  it('checks in and out by code with real Timestamps; a second guard is refused; a retry is idempotent', async () => {
    const { passCode } = await issue()
    const a = await checkInVisitorPass(deps, port(), sec(), { code: passCode, siteId: 'main', requestId: REQ })
    expect(a).toMatchObject({ recorded: true, at: NOW_MS })
    expect(await get(`visitorPasses/${id(1, 'vsp')}`)).toMatchObject({ status: 'checked_in', checkInBy: { uid: 'sec' }, checkInRequestId: REQ })
    await expect(checkInVisitorPass(deps, port(), sec(), { code: passCode, siteId: 'main', requestId: REQ })).resolves.toMatchObject({ recorded: true })
    expect((await db.collection('auditLog').where('action', '==', 'visitorPass.checkIn').get()).size).toBe(1)
    await rejects(checkInVisitorPass(deps, port(), sec(), { code: passCode, siteId: 'main', requestId: REQ2 }), 'already-exists', 'pass-already-checked-in')
    await checkOutVisitorPass(deps, port(), sec(), { passId: id(1, 'vsp'), requestId: REQ2 })
    expect(await get(`visitorPasses/${id(1, 'vsp')}`)).toMatchObject({ status: 'checked_out', checkOutRequestId: REQ2 })
  })

  it('two guards checking one pass in at once: exactly one wins', async () => {
    const { passCode } = await issue()
    await db.doc('users/sec2').set(userDoc({ role: 'security', contractorId: null, name: 'Sue', email: 's2@x.com', phone: null }))
    const results = await Promise.allSettled([
      checkInVisitorPass(deps, port(), sec(), { code: passCode, siteId: 'main', requestId: REQ }),
      checkInVisitorPass(deps, port(), caller('sec2', 'security'), { code: passCode, siteId: 'main', requestId: REQ2 }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await db.collection('auditLog').where('action', '==', 'visitorPass.checkIn').get()).size).toBe(1)
  })

  it('revokes an active pass, which then cannot be used', async () => {
    const { passCode } = await issue()
    await revokeVisitorPass(deps, port(), admin(), { passId: id(1, 'vsp'), reason: 'Cancelled' })
    expect(await get(`visitorPasses/${id(1, 'vsp')}`)).toMatchObject({ status: 'revoked', revokeReason: 'Cancelled', revokedBy: { uid: 'admin' } })
    await rejects(checkInVisitorPass(deps, port(), sec(), { code: passCode, siteId: 'main', requestId: REQ }), 'failed-precondition', 'pass-revoked')
  })

  it("never finds another company's pass by code", async () => {
    const { passCode } = await issue()
    await db.doc('users/secX').set(userDoc({ tenantId: 'T2', role: 'security', contractorId: null, name: 'X', email: 'x@x.com', phone: null }))
    await db.doc('tenants/T2').set({ timezone: 'Asia/Colombo' })
    await rejects(checkInVisitorPass(deps, port(), caller('secX', 'security', null, { tenantId: 'T2' }), { code: passCode, siteId: 'main', requestId: REQ }), 'not-found', 'visitor-pass-not-found')
  })

  it('the schedule expires old passes, flags a long stay once, and closes nothing', async () => {
    const a = await issue(1)
    await issue(2)
    await issue(3)
    // 1: past its last day. 2: inside for 10 hours (limit 8). 3: untouched.
    await db.doc(`visitorPasses/${id(1, 'vsp')}`).update({ validUntil: new Date(NOW_MS - 1000) })
    await checkInVisitorPass(deps, port(), sec(), { passId: id(2, 'vsp'), siteId: 'main', requestId: REQ })
    await db.doc(`visitorPasses/${id(2, 'vsp')}`).update({ checkInAt: new Date(NOW_MS - 10 * 3_600_000) })
    const first = await expireVisitorPasses(port(), NOW_MS)
    expect(first).toMatchObject({ expired: 1, flagged: 1, failedTenants: 0 })
    expect(await get(`visitorPasses/${id(1, 'vsp')}`)).toMatchObject({ status: 'expired' })
    expect(await get(`visitorPasses/${id(2, 'vsp')}`)).toMatchObject({ status: 'checked_in', dwellWarning: true })
    expect(await get(`visitorPasses/${id(3, 'vsp')}`)).toMatchObject({ status: 'active' })
    expect(await expireVisitorPasses(port(), NOW_MS)).toMatchObject({ expired: 0, flagged: 0 })
    await rejects(checkInVisitorPass(deps, port(), sec(), { code: a.passCode, siteId: 'main', requestId: REQ2 }), 'failed-precondition', 'pass-expired')
  })
})
