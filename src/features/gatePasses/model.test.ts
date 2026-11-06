import { describe, expect, it } from 'vitest'
import type { EligibilityResult } from '@/types/penalties'
import {
  badgeOf,
  countByStatus,
  currentMonthKey,
  entryKey,
  filterPasses,
  monthLabel,
  overviewMonths,
  previousMonth,
  pruneSelection,
  sortPasses,
  toggleAll,
  toggleKey,
  unresolvedCauses,
  unresolvedText,
  type PassRow,
} from './model'

const pass = (over: Partial<PassRow> & { id: string }): PassRow =>
  ({ tenantId: 'T', vehicleId: 'v', driverId: 'd', contractorId: 'C', plateNo: 'WP A-1', driverName: 'Dan', month: '2026-11', status: 'active', blockedReason: null, ...over }) as PassRow

describe('months', () => {
  it('reads the month in the company timezone, not the browser’s', () => {
    // 30 Nov 2026 20:00 UTC is already 1 Dec in Colombo (UTC+5:30), still 30 Nov in London.
    const at = new Date(Date.UTC(2026, 10, 30, 20, 0))
    expect(currentMonthKey('Asia/Colombo', at)).toBe('2026-12')
    expect(currentMonthKey('Europe/London', at)).toBe('2026-11')
  })
  it('walks back across a year and labels months', () => {
    expect(previousMonth('2027-01')).toBe('2026-12')
    expect(previousMonth('2026-11')).toBe('2026-10')
    expect(monthLabel('2026-11')).toBe('November 2026')
    expect(overviewMonths('2026-12')).toEqual(['2027-01', '2026-12', '2026-11'])
  })
})

describe('list helpers', () => {
  const rows = [
    pass({ id: '1', status: 'active', plateNo: 'WP B-2' }),
    pass({ id: '2', status: 'expired', plateNo: 'WP A-1' }),
    pass({ id: '3', status: 'blocked', plateNo: 'WP C-3', blockedReason: 'penalty' }),
    pass({ id: '4', status: 'active', plateNo: 'WP A-1', driverName: 'Zed' }),
  ]
  it('puts blocked passes first, then active, then expired, by plate', () => {
    expect(sortPasses(rows).map((r) => r.id)).toEqual(['3', '4', '1', '2'])
  })
  it('counts by status and filters by status and words', () => {
    expect(countByStatus(rows)).toEqual({ active: 2, blocked: 1, expired: 1 })
    const hay = (r: PassRow) => `${r.plateNo} ${r.driverName}`
    expect(filterPasses(rows, 'active', hay, '').map((r) => r.id)).toEqual(['1', '4'])
    expect(filterPasses(rows, '', hay, 'a-1 zed').map((r) => r.id)).toEqual(['4'])
    expect(filterPasses(rows, 'blocked', hay, 'a-1')).toEqual([])
  })
})

describe('badgeOf: Gate Pass: Active / Blocked (reason) / Expired / Not issued', () => {
  it('is Not issued with no pass, and shows the best status otherwise', () => {
    expect(badgeOf([])).toEqual({ status: 'not_issued', reason: null })
    expect(badgeOf([{ status: 'blocked', blockedReason: 'penalty' }])).toEqual({ status: 'blocked', reason: 'penalty' })
    expect(badgeOf([{ status: 'blocked', blockedReason: 'penalty' }, { status: 'active', blockedReason: null }])).toEqual({ status: 'active', reason: null })
    expect(badgeOf([{ status: 'expired', blockedReason: null }])).toEqual({ status: 'expired', reason: null })
  })
})

describe('unresolvedCauses', () => {
  const eligible = (over: Partial<EligibilityResult> = {}): EligibilityResult =>
    ({
      status: 'valid', blocked: false, eligible: true, checkedAt: 1,
      vehicle: { id: 'v', documentStatus: 'valid', blocked: false, penalties: [] },
      driver: { id: 'd', documentStatus: 'valid', blocked: false, penalties: [] },
      inspection: { status: 'cleared', cleared: true, reason: null, at: 1 },
      ...over,
    }) as EligibilityResult
  it('is empty once documents, penalties and the inspection are all fine', () => {
    expect(unresolvedCauses(eligible())).toEqual([])
  })
  it('names each thing that still stands in the way', () => {
    const e = eligible({
      vehicle: { id: 'v', documentStatus: 'expired', blocked: false, penalties: [] },
      driver: { id: 'd', documentStatus: 'valid', blocked: true, penalties: [] },
      inspection: { status: 'needs_reinspection', cleared: false, reason: 'manual', at: 1 },
    })
    expect(unresolvedCauses(e)).toEqual(['penalty', 'document_expired', 'inspection_invalidated'])
    expect(unresolvedText(['penalty', 'inspection_invalidated'])).toBe('A penalty is still in force · The vehicle needs a new inspection')
  })
})

describe('month-end selection', () => {
  const a = { vehicleId: 'v1', driverId: 'd1' }
  const keys = ['v1_d1', 'v1_d2', 'v2_d1']
  it('keys are the pairing', () => {
    expect(entryKey(a)).toBe('v1_d1')
  })
  it('an individual toggle adds and removes', () => {
    const one = toggleKey(new Set(), 'v1_d1')
    expect([...one]).toEqual(['v1_d1'])
    expect(toggleKey(one, 'v1_d1').size).toBe(0)
  })
  it('select all selects everything shown, and clears it when everything is already selected', () => {
    const all = toggleAll(new Set(), keys)
    expect([...all].sort()).toEqual(keys)
    expect(toggleAll(all, keys).size).toBe(0)
  })
  it('select all with a narrowed list leaves the rest alone, and tops up a partial selection', () => {
    const partial = toggleAll(new Set(['v2_d1']), ['v1_d1', 'v1_d2'])
    expect([...partial].sort()).toEqual(['v1_d1', 'v1_d2', 'v2_d1'])
    const cleared = toggleAll(partial, ['v1_d1', 'v1_d2'])
    expect([...cleared]).toEqual(['v2_d1'])
    expect(toggleAll(new Set(), []).size).toBe(0)
  })
  it('drops ticks for rows that left the list', () => {
    expect([...pruneSelection(new Set(['a', 'b']), new Set(['b', 'c']))]).toEqual(['b'])
  })
})
