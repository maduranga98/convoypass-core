import { describe, expect, it } from 'vitest'
import { buildReport } from './index.js'
import { checkRange, dayStartMs, formatLocal, rangeBounds } from './range.js'
import { median, percentile } from './stats.js'
import { hist, makeInput, makePass, MIN, T0 } from './fixtures.js'
import type { ReportPass } from './types.js'


const col = (rows: Record<string, unknown>[], key: string) => rows.map((r) => r[key])

describe('percentile', () => {
  it('a single value is every percentile', () => {
    expect(percentile([7], 0.5)).toBe(7)
    expect(percentile([7], 0.9)).toBe(7)
  })
  it('even count: the median is the mean of the two middle values', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('p90 interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
  })
  it('no values gives null, and the input is not mutated', () => {
    expect(percentile([], 0.5)).toBeNull()
    const v = [3, 1, 2]
    median(v)
    expect(v).toEqual([3, 1, 2])
  })
})

describe('range', () => {
  it('validates real dates, order and the 92 day maximum', () => {
    expect(checkRange('2026-02-30', '2026-03-01')).toEqual({ ok: false, problem: 'invalid-date' })
    expect(checkRange('2026-3-1', '2026-03-02')).toEqual({ ok: false, problem: 'invalid-date' })
    expect(checkRange('2026-03-02', '2026-03-01')).toEqual({ ok: false, problem: 'order' })
    expect(checkRange('2026-03-01', '2026-03-01')).toEqual({ ok: true, days: 1 })
    expect(checkRange('2026-01-01', '2026-04-02')).toEqual({ ok: true, days: 92 })
    expect(checkRange('2026-01-01', '2026-04-03')).toEqual({ ok: false, problem: 'too-long' })
  })
  it('maps days to timestamp boundaries at local midnight (Asia/Colombo is UTC+5:30)', () => {
    const b = rangeBounds('Asia/Colombo', '2026-03-10', '2026-03-10')
    expect(b.startMs).toBe(Date.UTC(2026, 2, 9, 18, 30))
    expect(b.endMs).toBe(Date.UTC(2026, 2, 10, 18, 30))
    expect([b.fromKey, b.toKey]).toEqual(['20260310', '20260310'])
  })
  it('a check-in at 23:55 and one at 00:05 land on the right days', () => {
    const day10 = rangeBounds('Asia/Colombo', '2026-03-10', '2026-03-10')
    const late = Date.UTC(2026, 2, 10, 18, 25) // 23:55 on the 10th, local
    const early = Date.UTC(2026, 2, 10, 18, 35) // 00:05 on the 11th, local
    const inDay = (ms: number) => ms >= day10.startMs && ms < day10.endMs
    expect(inDay(late)).toBe(true)
    expect(inDay(early)).toBe(false)
    const day11 = rangeBounds('Asia/Colombo', '2026-03-11', '2026-03-11')
    expect(early >= day11.startMs && early < day11.endMs).toBe(true)
    expect(formatLocal('Asia/Colombo', late)).toBe('2026-03-10 23:55')
    expect(formatLocal('Asia/Colombo', early)).toBe('2026-03-11 00:05')
  })
  it('handles zones that are behind UTC and DST days', () => {
    expect(dayStartMs('America/New_York', '2026-03-08')).toBe(Date.UTC(2026, 2, 8, 5, 0))
    expect(dayStartMs('America/New_York', '2026-03-09')).toBe(Date.UTC(2026, 2, 9, 4, 0))
  })
})

describe('turnaround', () => {
  const full = (id: string, contractorId: string, sup: number, off: number, gate: number): ReportPass =>
    makePass({
      id,
      contractorId,
      status: 'checked_in',
      supervisor: { uid: 'u1', name: 'Sam', at: T0 + sup * MIN },
      officer: { uid: 'o1', name: 'Olu', at: T0 + (sup + off) * MIN },
      checkIn: { uid: 's1', name: 'Gus', at: T0 + (sup + off + gate) * MIN, gateId: 'main', gateName: 'Main Gate', requestId: 'r' },
      history: [
        hist('approve', 'supervisor', T0 + sup * MIN),
        hist('approve', 'officer', T0 + (sup + off) * MIN, 1, { uid: 'o1', name: 'Olu', role: 'officer' }),
        hist('check_in', 'gate', T0 + (sup + off + gate) * MIN, 1, { uid: 's1', name: 'Gus', role: 'security' }),
      ],
    })

  it('uses only the latest attempt for timing', () => {
    const resubmitted = makePass({
      attempt: 2,
      status: 'checked_in',
      submittedAt: T0 + 120 * MIN, // attempt 2 was submitted two hours later
      history: [
        hist('reject', 'supervisor', T0 + 5 * MIN, 1),
        hist('approve', 'supervisor', T0 + 130 * MIN, 2),
        hist('approve', 'officer', T0 + 150 * MIN, 2, { uid: 'o1', name: 'Olu', role: 'officer' }),
        hist('check_in', 'gate', T0 + 160 * MIN, 2, { uid: 's1', name: 'Gus', role: 'security' }),
      ],
    })
    const r = buildReport(makeInput({ passes: [resubmitted] }))
    const all = r.rows.at(-1)
    expect(all).toMatchObject({ supervisorMedian: 10, officerMedian: 20, gateMedian: 10, totalMedian: 40, isTotal: true })
  })

  it('a missing stage only drops that pass from the metrics that need it', () => {
    const noOfficer = makePass({
      id: 'b',
      status: 'supervisor_approved',
      history: [hist('approve', 'supervisor', T0 + 30 * MIN)],
    })
    const r = buildReport(makeInput({ passes: [full('a', 'C1', 10, 20, 5), noOfficer] }))
    const section = r.summary.sections.find((s) => s.key === 'overall')
    expect(section?.rows).toEqual([
      { metric: 'Submit → supervisor', count: 2, median: 20, p90: 28 },
      { metric: 'Supervisor → officer', count: 1, median: 20, p90: 20 },
      { metric: 'Officer → check-in', count: 1, median: 5, p90: 5 },
      { metric: 'Submit → check-in', count: 1, median: 35, p90: 35 },
    ])
  })

  it('splits per contractor and per approver', () => {
    const r = buildReport(makeInput({ passes: [full('a', 'C1', 10, 20, 5), full('b', 'C2', 30, 40, 5)] }))
    expect(col(r.rows, 'contractor')).toEqual(['Alpha', 'Beta', 'All contractors'])
    expect(col(r.rows, 'supervisorMedian')).toEqual([10, 30, 20])
    const approvers = r.summary.sections.find((s) => s.key === 'approvers')?.rows
    expect(approvers).toContainEqual({ name: 'Sam', role: 'supervisor', decisions: 2, median: 20 })
    expect(approvers).toContainEqual({ name: 'Olu', role: 'officer', decisions: 2, median: 30 })
  })
})

describe('contractor_activity', () => {
  it('counts submissions as the sum of attempts and rejections as every reject and revoke', () => {
    const a = makePass({
      id: 'a',
      attempt: 2,
      status: 'checked_in',
      history: [
        hist('reject', 'supervisor', T0, 1),
        hist('approve', 'supervisor', T0 + MIN, 2),
        hist('approve', 'officer', T0 + 2 * MIN, 2, { uid: 'o1', name: 'Olu', role: 'officer' }),
        hist('check_in', 'gate', T0 + 3 * MIN, 2, { uid: 's1', name: 'Gus', role: 'security' }),
      ],
    })
    const b = makePass({
      id: 'b',
      status: 'rejected',
      history: [
        hist('approve', 'supervisor', T0),
        hist('approve', 'officer', T0 + MIN, 1, { uid: 'o1', name: 'Olu', role: 'officer' }),
        hist('revoke', 'revoked', T0 + 2 * MIN, 1, { uid: 'o1', name: 'Olu', role: 'officer' }),
      ],
    })
    const c = makePass({ id: 'c', contractorId: 'C2', status: 'submitted' })
    const r = buildReport(makeInput({ type: 'contractor_activity', passes: [a, b, c] }))
    expect(r.rows[0]).toMatchObject({
      contractor: 'Alpha', submissions: 3, supervisorApproved: 2, officerApproved: 2, checkedIn: 1, rejections: 2,
    })
    expect(r.rows[0]?.rejectionRate).toBeCloseTo(2 / 3)
    expect(r.rows[1]).toMatchObject({ contractor: 'Beta', submissions: 1, rejections: 0, rejectionRate: 0 })
    expect(r.rows.at(-1)).toMatchObject({ contractor: 'Total', submissions: 4, rejections: 2, isTotal: true })
  })
  it('sorts by submissions, biggest first', () => {
    const passes = [
      makePass({ id: 'a', contractorId: 'C2' }),
      makePass({ id: 'b', contractorId: 'C2', attempt: 3 }),
      makePass({ id: 'c', contractorId: 'C1' }),
    ]
    const r = buildReport(makeInput({ type: 'contractor_activity', passes }))
    expect(col(r.rows, 'contractor')).toEqual(['Beta', 'Alpha', 'Total'])
  })
})

describe('rejections', () => {
  const rej = (code: string, at: number, stage: 'supervisor' | 'officer' | 'revoked', byName: string, note?: string) => ({
    reason: code, reasonCode: code, stage, byUid: byName, byName, byRole: 'supervisor' as const, at, ...(note ? { note } : {}),
  })
  it('combines rejectionHistory with the current rejection of a rejected pass only', () => {
    const rejected = makePass({
      id: 'a',
      attempt: 2,
      status: 'rejected',
      rejectionHistory: [{ ...rej('gps_unclear', T0, 'supervisor', 'Sam'), attempt: 1 }],
      rejection: rej('other', T0 + MIN, 'officer', 'Olu', 'blurry'),
    })
    // Resubmitted and approved: its stale `rejection` is gone, only the history remains.
    const fixed = makePass({
      id: 'b',
      contractorId: 'C2',
      attempt: 2,
      status: 'supervisor_approved',
      rejectionHistory: [{ ...rej('gps_unclear', T0 + 2 * MIN, 'supervisor', 'Sam'), attempt: 1 }],
    })
    const r = buildReport(makeInput({ type: 'rejections', passes: [rejected, fixed] }))
    expect(r.rows).toHaveLength(3)
    expect(col(r.rows, 'reason')).toEqual(['GPS unclear', 'Other', 'GPS unclear'])
    expect(col(r.rows, 'stage')).toEqual(['Supervisor', 'Officer', 'Supervisor'])
    const byReason = r.summary.sections.find((s) => s.key === 'byReason')?.rows
    expect(byReason?.[0]).toMatchObject({ name: 'GPS unclear', count: 2 })
    expect(r.summary.tiles.find((t) => t.key === 'passes')?.value).toBe(2)
  })
})

describe('history and gate log', () => {
  it('vehicle history has one row per pass with the stage details and no photo data', () => {
    const p = makePass({
      status: 'checked_in',
      supervisor: { uid: 'u1', name: 'Sam', at: T0 + MIN },
      officer: { uid: 'o1', name: 'Olu', at: T0 + 2 * MIN },
      checkIn: { uid: 's1', name: 'Gus', at: T0 + 3 * MIN, gateId: 'main', gateName: 'Main Gate', requestId: 'r' },
    })
    const r = buildReport(makeInput({ type: 'vehicle_history', passes: [p] }))
    expect(r.rows).toEqual([
      expect.objectContaining({ date: '2026-03-10', plate: 'WP CAB 1234', driver: 'Nimal', status: 'Checked in', attempts: 1, supervisor: 'Sam', officer: 'Olu', gate: 'Main Gate' }),
    ])
    expect(JSON.stringify(r)).not.toMatch(/jpg|https?:|path/i)
  })
  it('gate log merges check-ins and denials oldest first and labels offline times unverified', () => {
    const p = makePass({
      status: 'checked_in',
      checkIn: {
        uid: 's1', name: 'Gus', at: T0 + 10 * MIN, gateId: 'main', gateName: 'Main Gate', requestId: 'r',
        offlineCapturedAt: new Date(T0 + 8 * MIN).toISOString(),
      },
    })
    const r = buildReport(
      makeInput({
        type: 'gate_log',
        passes: [p],
        events: [{
          id: 'den_1', tenantId: 'T1', type: 'denied', vehicleId: 'veh_bbbbbbbbbb', plateNo: 'WP XX 1', contractorId: 'C2', passId: null,
          passStatus: null, driverName: null, dateKey: '20260310', reasonCode: 'not_approved', gateId: 'main', gateName: 'Main Gate',
          byUid: 's1', byName: 'Gus', at: T0 + 5 * MIN, requestId: 'q',
        }],
      }),
    )
    expect(col(r.rows, 'type')).toEqual(['Denied', 'Check-in'])
    expect(r.rows[1]?.offline).toBe('Offline · device 2026-03-10 08:08 (unverified)')
    expect(r.rows[0]?.note).toBe('Vehicle not approved')
    expect(r.summary.tiles.map((t) => t.value)).toEqual([1, 1, 2])
  })
})

describe('gate_passes (gate pass details of a day)', () => {
  const day = (over: Partial<ReportPass> = {}) =>
    makePass({
      status: 'checked_in',
      supervisor: { uid: 's', name: 'Sue', at: T0 + 10 * MIN },
      officer: { uid: 'o', name: 'Olga', at: T0 + 20 * MIN },
      checkIn: { uid: 'g', name: 'Gus', at: T0 + 30 * MIN, gateId: 'main', gateName: 'Main Gate', requestId: 'r' },
      ...over,
    })
  const visit = (id: string, inMin: number, outMin: number | null) => ({
    id,
    passId: 'veh_aaaaaaaaaa_20260310',
    vehicleId: 'veh_aaaaaaaaaa',
    dateKey: '20260310',
    checkInAt: T0 + inMin * MIN,
    checkOutAt: outMin === null ? null : T0 + outMin * MIN,
  })

  it('shows approvals, the first entry, the end of the gate time, every entry and the time inside', () => {
    const r = buildReport(
      makeInput({
        type: 'gate_passes',
        generatedAt: T0 + 300 * MIN,
        passes: [day()],
        visits: [visit('a', 30, 90), visit('b', 120, 180), visit('c', 240, null)],
      }),
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      date: '2026-03-10', plate: 'WP CAB 1234', contractor: 'Alpha', status: 'Checked in', supervisor: 'Sue', officer: 'Olga',
      firstIn: T0 + 30 * MIN, endsAt: T0 + 30 * MIN + 16 * 60 * MIN, entries: 3, lastOut: T0 + 180 * MIN,
      onSiteMinutes: 60 + 60 + 60, gate: 'Inside',
    })
    expect(r.summary.tiles.map((t) => [t.key, t.value])).toEqual([['passes', 1], ['approved', 1], ['entered', 1], ['entries', 3], ['inside', 1], ['rejected', 0]])
  })

  it('a pass that never came in has no entry columns; the company gate time sets the end', () => {
    const r = buildReport(
      makeInput({ type: 'gate_passes', gateTimeHours: 10, passes: [makePass({ status: 'officer_approved' }), day({ id: 'veh_bbbbbbbbbb_20260310', vehicleId: 'veh_bbbbbbbbbb', plateNo: 'AA 1' })], visits: [] }),
    )
    expect(col(r.rows, 'plate')).toEqual(['AA 1', 'WP CAB 1234'])
    expect(r.rows[1]).toMatchObject({ gate: 'Not entered', firstIn: null, endsAt: null, entries: 0, onSiteMinutes: null })
    expect(r.rows[0]?.endsAt).toBe(T0 + 30 * MIN + 10 * 60 * MIN)
  })
})
