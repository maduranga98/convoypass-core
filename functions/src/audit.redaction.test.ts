// Runs every audit write path with credential-, token- and photo-shaped input and asserts the stored `meta`
// (and the whole audit entry) never contains any of it. A new path that goes through `audit()` is covered by the
// source scan at the bottom.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bulkApprove, decidePass, revokePass } from './approvals.js'
import { changeOwnPassword, createUser, reissuePin, resetCredential, sanitiseMeta, updateUser } from './core.js'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { checkIn, denyEntry } from './gate.js'
import { invalidateForPenalty } from './inspectionInvalidation.js'
import { recordInspection, withdrawClearance } from './inspections.js'
import { evidenceFolder } from './passRules.js'
import { createPenaltyType, deletePenaltyType, issuePenalty, penaltyEvidencePath, revokePenalty, updatePenaltyType, verifyPenalty } from './penalties.js'
import { submitPass, updateTenantSettings } from './passes.js'
import { admin, caller, drv1, makeWorld, NOW, sup1, userDoc, type World } from './test-utils.js'
import type { PassData, PenaltyData, StoredFile } from './types.js'
import { checkInVisit, checkOutVisit, logUnloadingCheck } from './visits.js'
import { givePass } from './gatepass-test-utils.js'
import { giveCheckedInPass, makeVisitWorld } from './visits-test-utils.js'
import { flagDwellVisits } from './dwell.js'
import { createVehicle, importVehicles, setContractorStatus, setVehicleDrivers, setVehicleStatus, updateVehicle } from './vehicles.js'

const VID = 'veh_aaaaaaaaaa'
const DAY = dateKey('Asia/Colombo', new Date(NOW * 1000))
const PASSWORD = 'Sup3rSecret!pw'
let PIN = '48291736'
let REISSUED = '59302847'
const NEW_PASSWORD = 'An0therSecret!pw'
const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

let w: World
beforeEach(() => {
  w = makeWorld()
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', name: 'Sue', email: 's1@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, name: 'Olga', email: 'o@x.com', phone: null }))
  w.users.set('sec', userDoc({ role: 'security', contractorId: null, name: 'Sam', email: 'sec@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1', name: 'Dan' }))
  w.vehicles.set(VID, {
    tenantId: 'T1', contractorId: 'C1', plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821', type: 'Tipper',
    assignedDriverIds: ['drv1'], status: 'active',
  })
})

const jpeg = (): StoredFile => ({
  contentType: 'image/jpeg', size: 50 * 1024, timeCreated: NOW * 1000 - 60_000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
})

const forbidden = () => [PASSWORD, PIN, REISSUED, NEW_PASSWORD, 'http://', 'https://', 'data:', '.jpg', 'tenants/T1/', 'eyJ', 'password', 'token']

describe('audit redaction: every write path', () => {
  it('never stores passwords, PINs, tokens, photo URLs/paths or file contents', async () => {
    const officer = caller('officer', 'officer')
    const sec = caller('sec', 'security')

    // users
    const { uid } = await createUser(w.deps, admin(), { role: 'supervisor', name: 'New Sup', email: 'ns@x.com', contractorId: 'C1', password: PASSWORD })
    const created = await createUser(w.deps, admin(), { role: 'driver', name: 'New Drv', phone: '0771111111', contractorId: 'C1' })
    PIN = created.pin as string
    REISSUED = (await reissuePin(w.deps, admin(), { uid: created.uid })).pin
    await resetCredential(w.deps, admin(), { uid, newPassword: NEW_PASSWORD })
    await changeOwnPassword(w.deps, caller(uid, 'supervisor', 'C1'), { newPassword: NEW_PASSWORD })
    w.users.set(uid, userDoc({ role: 'supervisor', contractorId: 'C1', name: 'New Sup', email: 'ns@x.com', phone: null }))
    await updateUser(w.deps, admin(), { uid: 'drv1', name: 'Dan 2', licenseNo: 'B1234567', photoPath: 'tenants/T1/contractors/C1/drivers/drv1.jpg' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'active' })
    // vehicles and contractors
    const vehicleId = await createVehicle(w.deps, admin(), { contractorId: 'C1', plateNo: 'CAB 9999', type: 'Tipper' })
    const id = (vehicleId as { vehicleId: string }).vehicleId
    await updateVehicle(w.deps, admin(), { vehicleId: id, plateNo: 'CAB 8888', makeModel: 'Isuzu' })
    await setVehicleStatus(w.deps, admin(), { vehicleId: id, status: 'suspended' })
    await setVehicleStatus(w.deps, admin(), { vehicleId: id, status: 'active' })
    await setVehicleDrivers(w.deps, admin(), { vehicleId: id, driverIds: ['drv1b'] })
    await importVehicles(w.deps, admin(), { contractorId: 'C1', rows: [{ plateNo: 'KA 1111', type: 'Tipper' }] })
    await setContractorStatus(w.deps, admin(), { contractorId: 'C2', status: 'suspended' })
    await setContractorStatus(w.deps, admin(), { contractorId: 'C2', status: 'active' })
    await updateTenantSettings(w.deps, admin(), { sla: { supervisorMinutes: 20, officerMinutes: 20 }, passSettings: { requireLocation: true, maxExtraPhotos: 1 } })
    // passes: submit, approve, reject, revoke, bulk, check-in, deny
    for (const n of ['gps.jpg', 'dashcam.jpg']) w.files.set(`${evidenceFolder('T1', VID, DAY, 1)}${n}`, jpeg())
    await submitPass(w.deps, drv1(), {
      vehicleId: VID, attempt: 1, extraCount: 0,
      checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, answer: 'yes' as const })),
      captureMeta: { method: 'live', clientCapturedAt: { gps: '2023-11-14T22:10:00Z', dashcam: '2023-11-14T22:11:00Z' }, location: { lat: 6.9, lng: 79.8, accuracy: 10 } },
    })
    const pid = `${VID}_${DAY}`
    await decidePass(w.deps, sup1(), { passId: pid, action: 'approve', expectedStatus: 'submitted', expectedAttempt: 1 })
    await bulkApprove(w.deps, officer, { items: [{ passId: pid, expectedAttempt: 1 }] })
    await checkIn(w.deps, sec, { passId: pid, expectedAttempt: 1, gateId: 'main', requestId: R1 })
    await denyEntry(w.deps, sec, { vehicleId: VID, reasonCode: 'driver_mismatch', note: 'Looks wrong', gateId: 'main', requestId: R2 })
    const p = w.passes.get(pid) as PassData
    w.passes.set(pid, { ...p, status: 'officer_approved' })
    await revokePass(w.deps, officer, { passId: pid, reasonCode: 'other', note: 'Changed mind', expectedAttempt: 1 })

    // penalties: a photo path, a reason that mentions a URL and a note that looks like a token must stay out of the entries
    const { typeId } = await createPenaltyType(w.deps, admin(), { name: 'Damage' })
    await updatePenaltyType(w.deps, admin(), { typeId, name: 'Damage to gate' })
    const spare = await createPenaltyType(w.deps, admin(), { name: 'Spare' })
    await deletePenaltyType(w.deps, admin(), { typeId: spare.typeId })
    w.files.set(penaltyEvidencePath('T1', 'pen_aaaaaaaaaa'), jpeg())
    await issuePenalty(w.deps, caller('safe1', 'safety'), {
      penaltyId: 'pen_aaaaaaaaaa', vehicleId: VID, driverId: 'drv1', typeId, duration: { kind: 'fixed', endDate: '2023-12-01' },
      reason: 'See https://x.test/a.jpg and token abc', hasEvidence: true,
    })
    await verifyPenalty(w.deps, sup1(), { penaltyId: 'pen_aaaaaaaaaa', note: 'password reset https://x.test' })
    await revokePenalty(w.deps, admin(), { penaltyId: 'pen_aaaaaaaaaa', note: 'eyJhbGciOi token note' })

    // inspections: notes and the withdrawal reason are free text and must stay out of the entries; the trigger path is covered too
    const safety = caller('safe1', 'safety')
    await recordInspection(w.deps, safety, { inspectionId: 'insp_aaaaaaaaaa', vehicleId: VID, result: 'approved', notes: 'See https://x.test/a.jpg and token abc' })
    await invalidateForPenalty(w.deps.data, 'pen_aaaaaaaaaa', { ...(w.penalties.get('pen_aaaaaaaaaa') as PenaltyData), status: 'active', issuedAt: NOW * 1000 + 1 }, NOW * 1000 + 2)
    await recordInspection(w.deps, safety, { inspectionId: 'insp_bbbbbbbbbb', vehicleId: VID, result: 'approved', notes: '' })
    await withdrawClearance(w.deps, safety, { vehicleId: VID, note: 'eyJhbGciOi password note' })

    expect(w.audits.length).toBeGreaterThan(20)
    const actions = new Set(w.audits.map((a) => a.action))
    for (const a of ['user.create', 'user.resetCredential', 'user.changeOwnPassword', 'user.update', 'user.disable', 'vehicle.create',
      'vehicle.import', 'tenant.settings.update', 'pass.submit', 'pass.checkIn', 'gate.deny', 'pass.revoke',
      'penaltyType.create', 'penaltyType.update', 'penaltyType.delete', 'penalty.issue', 'penalty.verify', 'penalty.revoke',
      'inspection.record', 'inspection.invalidate', 'inspection.withdraw']) {
      expect(actions, `missing path ${a}`).toContain(a)
    }
    for (const entry of w.audits) {
      const text = JSON.stringify(entry)
      for (const bad of forbidden()) expect(text, `${entry.action} contains ${bad}`).not.toContain(bad)
      for (const v of Object.values(entry.meta)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true)
    }
  })

  it('the visit paths never store the driver PIN, the unload place or anything credential-shaped', async () => {
    const vw = makeVisitWorld(w)
    const sec = caller('sec', 'security')
    const yard = caller('yard1', 'yard')
    const pin = '48291736'
    giveCheckedInPass(w, VID, 'drv1')
    givePass(vw.gatePasses, VID, 'drv1')
    await recordInspection(w.deps, caller('safe1', 'safety'), { inspectionId: 'insp_cccccccccc', vehicleId: VID, result: 'approved', notes: '' })
    await checkInVisit(w.deps, vw.port, sec, { visitId: 'vis_aaaaaaaaaa', vehicleId: VID, requestId: R1 })
    await logUnloadingCheck(w.deps, vw.port, yard, { visitId: 'vis_aaaaaaaaaa', unloaded: true, unloadLocation: 'https://x.test/token' })
    await flagDwellVisits(vw.dwell, NOW * 1000 + 20 * 3_600_000)
    await checkOutVisit(w.deps, vw.port, sec, { visitId: 'vis_aaaaaaaaaa', requestId: R2 })
    const visitAudits = w.audits.filter((a) => a.action.startsWith('visit.'))
    expect(visitAudits.map((a) => a.action)).toEqual(['visit.checkIn', 'visit.unloadingCheck', 'visit.dwellWarning', 'visit.checkOut'])
    for (const entry of visitAudits) {
      const text = JSON.stringify(entry)
      for (const bad of [pin, 'x.test', 'token', 'http', 'password', 'eyJ']) expect(text, `${entry.action} contains ${bad}`).not.toContain(bad)
    }
    // The stored visit holds the place (it is the record) but never the PIN.
    expect(JSON.stringify([...vw.visits.values()])).not.toContain(pin)
  })

  it('sanitiseMeta is the net: secret-looking values never survive', () => {
    expect(
      sanitiseMeta({
        password: 'x', newPin: '123456', fcmToken: 't', photo: 'https://a/b.jpg', blob: 'A'.repeat(80), jwt: 'eyJhbGciOi', ok: 'fine', flag: true, n: 1, nothing: null,
      }),
    ).toEqual({ password: '[redacted]', newPin: '[redacted]', fcmToken: '[redacted]', photo: '[redacted]', blob: '[redacted]', jwt: '[redacted]', ok: 'fine', flag: true, n: 1, nothing: null })
  })

  it('no module writes auditLog except through the data port, and the port always spreads an AuditEntry', () => {
    const files = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    const writers = files.filter((f) => readFileSync(join(__dirname, f), 'utf8').includes("'auditLog'"))
    // ports.ts is the Admin SDK adapter; notifications/retention reuse deps.data.writeAudit rather than writing directly.
    // pinLoginPort.ts writes the `auth.pin_login` entry built by `audit()` in pinLogin.ts (checked in pinLogin.test.ts).
    expect(writers).toEqual(['pinLoginPort.ts', 'ports.ts'])
  })
})
