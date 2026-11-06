import { beforeEach, describe, expect, it } from 'vitest'
import { dateKey } from './dates.js'
import { DEFAULT_CHECKLIST } from './defaultChecklist.js'
import { makeNotifyWorld, type NotifyWorld } from './notify-test-utils.js'
import { isBreached, runSlaCheck, SLA_MAX_PASSES_PER_RUN } from './sla.js'
import { makeWorld, NOW, userDoc, type World } from './test-utils.js'
import type { PassData, PassStatus } from './types.js'

const NOW_MS = NOW * 1000
const MIN = 60_000
const DAY = dateKey('Asia/Colombo', new Date(NOW_MS))
let w: World
let nw: NotifyWorld
beforeEach(() => {
  w = makeWorld()
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, email: 'o@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1' }))
  nw = makeNotifyWorld(w)
})

const seed = (n: number, status: PassStatus, waitedMin: number, over: Partial<PassData> = {}) => {
  const vehicleId = `veh_${String(n).padStart(10, 'a')}`
  const id = `${vehicleId}_${DAY}`
  w.passes.set(id, {
    tenantId: 'T1', contractorId: 'C1', vehicleId, plateNo: `CAB-${n}`, vehicleType: 'Tipper', dateKey: DAY, driverId: 'drv1', driverName: 'D',
    status, attempt: 1, submittedAt: NOW_MS - (status === 'submitted' ? waitedMin : waitedMin + 5) * MIN,
    ...(status === 'supervisor_approved' ? { supervisor: { uid: 'sup1', name: 'S', at: NOW_MS - waitedMin * MIN } } : {}),
    checklist: DEFAULT_CHECKLIST.map((c) => ({ id: c.id, label: c.label, answer: 'yes' as const })),
    evidence: { gps: { path: 'g', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'd', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } }, ...over,
  })
  return id
}
const run = () => runSlaCheck(nw.sla, nw.deps)

describe('SLA reminders', () => {
  it('reminds the supervisors (and admins) of a submitted pass past the supervisor SLA, once', async () => {
    const id = seed(1, 'submitted', 45)
    const first = await run()
    expect(first).toMatchObject({ alerted: 1, notifications: 3, failed: 0 })
    expect(nw.uidsWithNotification('slaSupervisor_')).toEqual(['admin', 'admin2', 'sup1'])
    expect((w.passes.get(id) as PassData).slaAlerts?.supervisor).toMatchObject({ attempt: 1, at: NOW_MS })
    expect(nw.notifications.get(`slaSupervisor_${id}_1_sup1`)).toMatchObject({ type: 'sla_overdue', title: 'Approval overdue', link: `/supervisor/approvals/${id}` })
    // Idempotent: a re-run (the schedule fires every 10 minutes) changes nothing.
    const again = await run()
    expect(again).toMatchObject({ alerted: 0, notifications: 0 })
    expect(nw.notifications.size).toBe(3)
  })
  it('reminds officers for a supervisor_approved pass past the officer SLA, clock = supervisor.at, and it is a separate stage', async () => {
    const id = seed(1, 'supervisor_approved', 40, { slaAlerts: { supervisor: { attempt: 1, at: 1 } } })
    await run()
    expect(nw.uidsWithNotification('slaOfficer_')).toEqual(['admin', 'admin2', 'officer'])
    expect((w.passes.get(id) as PassData).slaAlerts).toMatchObject({ supervisor: { attempt: 1 }, officer: { attempt: 1 } })
  })
  it('skips passes inside the SLA, approved or checked-in passes, and yesterday’s passes', async () => {
    seed(1, 'submitted', 10)
    seed(2, 'officer_approved', 90)
    seed(3, 'checked_in', 90)
    seed(4, 'rejected', 90)
    const old = seed(5, 'submitted', 90)
    w.passes.set(old, { ...(w.passes.get(old) as PassData), dateKey: '20231113' })
    expect(await run()).toMatchObject({ alerted: 0 })
    expect(nw.notifications.size).toBe(0)
  })
  it('uses the tenant’s own SLA minutes', async () => {
    w.tenants.set('T1', { timezone: 'Asia/Colombo', sla: { supervisorMinutes: 60, officerMinutes: 10 } })
    seed(1, 'submitted', 45)
    seed(2, 'supervisor_approved', 15)
    await run()
    expect(nw.uidsWithNotification('slaSupervisor_')).toEqual([])
    expect(nw.uidsWithNotification('slaOfficer_')).toContain('officer')
  })
  it('a later attempt can be reminded again; the same attempt cannot', async () => {
    const id = seed(1, 'submitted', 45)
    await run()
    w.passes.set(id, { ...(w.passes.get(id) as PassData), attempt: 2 })
    expect(await run()).toMatchObject({ alerted: 1 })
    expect(nw.notifications.has(`slaSupervisor_${id}_2_sup1`)).toBe(true)
    expect(await run()).toMatchObject({ alerted: 0 })
  })
  it('a pass decided between the scan and the write is skipped by the transaction', async () => {
    const id = seed(1, 'submitted', 45)
    const original = nw.sla.alertTx
    nw.sla.alertTx = async (p) => {
      w.passes.set(id, { ...(w.passes.get(id) as PassData), status: 'supervisor_approved' })
      return original(p)
    }
    expect(await run()).toMatchObject({ alerted: 0 })
    expect(nw.notifications.size).toBe(0)
  })
  it('stays unstamped when nobody can be told, so a later run retries', async () => {
    w.users.delete('sup1')
    for (const k of ['admin', 'admin2']) w.users.delete(k)
    const id = seed(1, 'submitted', 45)
    expect(await run()).toMatchObject({ alerted: 0 })
    expect((w.passes.get(id) as PassData).slaAlerts).toBeUndefined()
  })
  it('handles at most 200 passes per tenant per run, oldest first', async () => {
    for (let i = 1; i <= SLA_MAX_PASSES_PER_RUN + 5; i++) seed(i, 'submitted', 45)
    expect(await run()).toMatchObject({ alerted: SLA_MAX_PASSES_PER_RUN })
    expect(await run()).toMatchObject({ alerted: 5 })
  })
  it('sends the collapsed approval push to the responsible party and a plain one to admins', async () => {
    nw.addDevice('sup1', 'd', 'tok-s')
    nw.addDevice('admin', 'd', 'tok-a')
    seed(1, 'submitted', 45)
    await run()
    expect(nw.sent.map((m) => m.tokens[0]).sort()).toEqual(['tok-a', 'tok-s'])
    expect(nw.sent.find((m) => m.tokens[0] === 'tok-s')?.data.tag).toBe('pending-supervisor-C1')
    expect(nw.sent.find((m) => m.tokens[0] === 'tok-a')?.data.tag).toMatch(/^sla_overdue-/)
  })
  it('isBreached needs a clock and a strictly longer wait', () => {
    const [p] = [...w.passes.values()]
    expect(p).toBeUndefined()
    const id = seed(1, 'submitted', 30)
    expect(isBreached(w.passes.get(id) as PassData, 'supervisor', 30, NOW_MS)).toBe(false)
    expect(isBreached(w.passes.get(id) as PassData, 'supervisor', 29, NOW_MS)).toBe(true)
    expect(isBreached({ ...(w.passes.get(id) as PassData), submittedAt: null }, 'supervisor', 1, NOW_MS)).toBe(false)
  })
})
