import { describe, expect, it } from 'vitest'
import { generateHistory, type FleetVehicle, type HistoryInput } from './demoHistory.ts'

const contractors = {
  lanka: { id: 'C1', supervisors: [{ uid: 's1', name: 'Kasun' }] },
  ceylon: { id: 'C2', supervisors: [{ uid: 's2', name: 'Dilini' }] },
}
const vehicles: FleetVehicle[] = Array.from({ length: 56 }, (_, i) => ({
  vehicleId: `veh_${String(i).padStart(10, 'a')}`,
  contractorKey: i % 2 === 0 ? 'lanka' : 'ceylon',
  plateNo: `WP HX-${1000 + i}`,
  vehicleType: 'Tipper',
  driverIds: [`d${i % 4}`],
}))

const input = (over: Partial<HistoryInput> = {}): HistoryInput => ({
  seed: 7,
  endDay: '2026-03-09',
  days: 30,
  timezone: 'Asia/Colombo',
  perDay: 40,
  tenantId: 'demo',
  vehicles,
  driverNames: { d0: 'A', d1: 'B', d2: 'C', d3: 'D' },
  contractors,
  officers: [{ uid: 'o1', name: 'Olivia' }, { uid: 'o2', name: 'Tariq' }],
  guards: [{ uid: 'g1', name: 'Nimal' }],
  gates: [{ id: 'main', name: 'Main Gate' }, { id: 'north', name: 'North Gate' }],
  checklist: [{ id: 'tyres', label: 'Tyres' }, { id: 'lights', label: 'Lights' }],
  reasons: [
    { id: 'gps_unclear', label: 'GPS unclear' }, { id: 'dashcam_unclear', label: 'Dashcam unclear' }, { id: 'checklist_issue', label: 'Checklist' },
    { id: 'wrong_vehicle', label: 'Wrong vehicle' }, { id: 'photo_not_fresh', label: 'Old photo' }, { id: 'other', label: 'Other' },
  ],
  taken: new Set<string>(),
  ...over,
})

const run = generateHistory(input())

describe('generateHistory', () => {
  it('is deterministic for a seed and differs for another', () => {
    expect(generateHistory(input())).toEqual(run)
    expect(generateHistory(input({ seed: 8 })).passes.map((p) => p.id)).not.toEqual(run.passes.map((p) => p.id))
  })

  it('makes about 40 passes a day for 30 days, one per vehicle per day', () => {
    const days = new Set(run.passes.map((p) => p.data.dateKey))
    expect(days.size).toBe(30)
    expect(run.passes.length / 30).toBeGreaterThan(30)
    expect(run.passes.length / 30).toBeLessThan(45)
    expect(new Set(run.passes.map((p) => p.id)).size).toBe(run.passes.length)
  })

  it('never regenerates a taken vehicle-day', () => {
    const first = run.passes[0]
    const again = generateHistory(input({ taken: new Set([first?.id ?? '']) }))
    expect(again.passes.some((p) => p.id === first?.id)).toBe(false)
  })

  it('rejects about 12% of first attempts, with a spread of reasons and both stages', () => {
    const firstAttempt = run.passes.map((p) => p.data.history.find((h) => h.attempt === 1 && (h.action === 'reject' || h.action === 'revoke')))
    const rate = firstAttempt.filter(Boolean).length / run.passes.length
    expect(rate).toBeGreaterThan(0.08)
    expect(rate).toBeLessThan(0.17)
    const reasons = new Set(run.passes.flatMap((p) => [...(p.data.rejectionHistory ?? []), ...(p.data.rejection ? [p.data.rejection] : [])].map((r) => r.reasonCode)))
    expect(reasons.size).toBeGreaterThanOrEqual(5)
    const stages = new Set(run.passes.flatMap((p) => (p.data.rejectionHistory ?? []).map((r) => r.stage)))
    expect(stages.has('supervisor') && stages.has('officer')).toBe(true)
  })

  it('has resubmissions, offline check-ins, denials and varied delays', () => {
    expect(run.passes.some((p) => p.data.attempt > 1)).toBe(true)
    expect(run.passes.some((p) => p.data.checkIn?.offlineCapturedAt)).toBe(true)
    expect(run.events.length).toBeGreaterThan(10)
    const delays = run.passes.flatMap((p) => (p.data.supervisor ? [Math.round((p.data.supervisor.at - p.data.submittedAt) / 60_000)] : []))
    expect(new Set(delays).size).toBeGreaterThan(20)
    expect(run.passes.filter((p) => p.data.status === 'checked_in').length / run.passes.length).toBeGreaterThan(0.6)
  })

  it('keeps every pass internally consistent and inside its local day', () => {
    for (const { id, data } of run.passes) {
      expect(id).toBe(`${data.vehicleId}_${data.dateKey}`)
      expect(data.attempt).toBe(1 + (data.rejectionHistory?.length ?? 0))
      if (data.status === 'rejected') expect(data.rejection).toBeDefined()
      else expect(data.rejection).toBeUndefined()
      if (data.status === 'checked_in') expect(data.checkIn && data.officer && data.supervisor).toBeTruthy()
      if (data.status === 'officer_approved') expect(data.officer).toBeDefined()
      const times = data.history.map((h) => h.at)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      expect(data.submittedAt).toBeGreaterThanOrEqual(Date.parse(`${data.dateKey.slice(0, 4)}-${data.dateKey.slice(4, 6)}-${data.dateKey.slice(6, 8)}T00:00:00+05:30`))
      expect(Math.max(...times, data.submittedAt)).toBeLessThan(Date.parse(`${data.dateKey.slice(0, 4)}-${data.dateKey.slice(4, 6)}-${data.dateKey.slice(6, 8)}T23:59:59+05:30`))
    }
  })
})
