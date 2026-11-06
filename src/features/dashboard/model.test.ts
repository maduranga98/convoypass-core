import { describe, expect, it } from 'vitest'
import { makePass, ts } from '@/test/passFactory'
import type { GateEventDoc } from '@/types/passes'
import { attentionItems, computeKpis, contractorRows, recentGateActivity } from './model'

const NOW = Date.UTC(2026, 2, 10, 6, 0)
const MIN = 60_000
const sla = { supervisorMinutes: 30, officerMinutes: 20 }

const waiting = (id: string, minutes: number, over = {}) =>
  makePass({ id, plateNo: id, status: 'submitted', submittedAt: ts(NOW - minutes * MIN), ...over })

describe('computeKpis', () => {
  it('counts today’s passes by current status', () => {
    const passes = [
      makePass({ id: '1', status: 'submitted' }),
      makePass({ id: '2', status: 'supervisor_approved' }),
      makePass({ id: '3', status: 'supervisor_approved' }),
      makePass({ id: '4', status: 'officer_approved' }),
      makePass({ id: '5', status: 'checked_in' }),
      makePass({ id: '6', status: 'rejected' }),
    ]
    expect(computeKpis(passes)).toEqual({ submitted: 6, waitingSupervisor: 1, waitingOfficer: 2, approved: 1, checkedIn: 1, rejected: 1 })
    expect(computeKpis([])).toEqual({ submitted: 0, waitingSupervisor: 0, waitingOfficer: 0, approved: 0, checkedIn: 0, rejected: 0 })
  })
})

describe('contractorRows', () => {
  it('sorts by waiting count, biggest first', () => {
    const rows = contractorRows(
      [
        makePass({ id: '1', contractorId: 'A', status: 'checked_in' }),
        makePass({ id: '2', contractorId: 'B', status: 'submitted' }),
        makePass({ id: '3', contractorId: 'B', status: 'supervisor_approved' }),
        makePass({ id: '4', contractorId: 'C', status: 'submitted' }),
        makePass({ id: '5', contractorId: 'C', status: 'rejected' }),
      ],
      (id) => `Contractor ${id}`,
    )
    expect(rows.map((r) => [r.name, r.waiting])).toEqual([['Contractor B', 2], ['Contractor C', 1], ['Contractor A', 0]])
    expect(rows[2]).toMatchObject({ submitted: 1, checkedIn: 1 })
    expect(rows[1]).toMatchObject({ submitted: 2, rejected: 1, waiting: 1 })
  })
})

describe('attentionItems', () => {
  it('lists only passes past their SLA, longest waiting first', () => {
    const items = attentionItems(
      [
        waiting('fresh', 10),
        waiting('late', 45),
        waiting('later', 90),
        waiting('exactly', 30),
        makePass({ id: 'officer-late', plateNo: 'officer-late', status: 'supervisor_approved', submittedAt: ts(NOW - 200 * MIN), supervisor: { uid: 's', name: 'S', at: ts(NOW - 25 * MIN) } }),
        makePass({ id: 'officer-ok', status: 'supervisor_approved', supervisor: { uid: 's', name: 'S', at: ts(NOW - 5 * MIN) } }),
        makePass({ id: 'approved', status: 'officer_approved', submittedAt: ts(NOW - 500 * MIN) }),
        makePass({ id: 'rejected', status: 'rejected', submittedAt: ts(NOW - 500 * MIN) }),
        makePass({ id: 'in', status: 'checked_in', submittedAt: ts(NOW - 500 * MIN) }),
      ],
      NOW,
      sla,
    )
    expect(items.map((i) => i.pass.id)).toEqual(['later', 'late', 'officer-late'])
    expect(items.map((i) => i.holder)).toEqual(['supervisor', 'supervisor', 'officer'])
    expect(items[0]).toMatchObject({ waitedMs: 90 * MIN, overMs: 60 * MIN })
    expect(items[2]).toMatchObject({ waitedMs: 25 * MIN, overMs: 5 * MIN })
  })
  it('a pass disappears once it is approved', () => {
    const stuck = waiting('p', 60)
    expect(attentionItems([stuck], NOW, sla)).toHaveLength(1)
    expect(attentionItems([{ ...stuck, status: 'supervisor_approved', supervisor: { uid: 's', name: 'S', at: ts(NOW - MIN) } }], NOW, sla)).toHaveLength(0)
  })
  it('uses the tenant’s own limits', () => {
    expect(attentionItems([waiting('p', 40)], NOW, { supervisorMinutes: 60, officerMinutes: 60 })).toHaveLength(0)
  })
})

describe('recentGateActivity', () => {
  it('merges check-ins and denials, newest first, capped at 15', () => {
    const checkIn = (n: number) =>
      makePass({
        id: `p${n}`, status: 'checked_in',
        checkIn: { uid: 'g', name: 'G', at: ts(NOW + n * MIN), gateId: 'main', gateName: 'Main Gate', requestId: `r${n}` },
      })
    const denied = { tenantId: 'T1', type: 'denied', vehicleId: 'v', plateNo: 'D', contractorId: 'C1', at: ts(NOW + 5.5 * MIN), gateName: 'North' } as unknown as GateEventDoc & { id: string }
    const passes = Array.from({ length: 20 }, (_, i) => checkIn(i))
    const out = recentGateActivity(passes, [{ ...denied, id: 'den_1' }])
    expect(out).toHaveLength(15)
    expect(out[0]?.id).toBe('c_p19')
    expect(recentGateActivity([checkIn(5), checkIn(6)], [{ ...denied, id: 'den_1' }]).map((a) => a.kind)).toEqual(['checkIn', 'denied', 'checkIn'])
  })
})
