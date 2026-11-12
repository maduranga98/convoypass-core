import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'
import type { VisitorPass, VisitorPassView } from '@/types/visitors'
import { matchesPass } from './filters'
import { onSiteRows } from './onSite'
import { verdictOf } from './verdict'

const NOW = Date.UTC(2026, 2, 10, 9, 0, 0)
const ts = (ms: number) => Timestamp.fromMillis(ms)

const pass = (over: Partial<VisitorPass> = {}, id = 'vsp_1'): WithId<VisitorPass> => ({
  id, tenantId: 'T', visitorId: 'vst_1', visitorName: 'Nimal Perera', visitorOrganization: 'Audit Co', hostName: 'Finance', purposeOfVisit: 'Quarterly audit',
  photoPath: null, siteId: 'main', siteName: 'Main Gate', passCode: 'ABCDEFGH', status: 'active', month: '202603', issuedAt: ts(NOW - 3_600_000),
  issuedBy: { uid: 'a', name: 'Admin', role: 'admin' }, validFrom: ts(NOW - 3_600_000), validUntil: ts(NOW + 3_600_000), maxDwellMinutes: 60,
  checkInAt: null, checkInBy: null, checkOutAt: null, checkOutBy: null, dwellWarning: false, revokedAt: null, revokedBy: null, revokeReason: null, notes: '', ...over,
})

const visit = (over: Partial<Visit> = {}, id = 'vis_1'): WithId<Visit> =>
  ({
    id, tenantId: 'T', vehicleId: 'veh_1', driverId: 'd', contractorId: 'c', plateNo: 'WP LJ-4821', driverName: 'Kamal',
    checkIn: { timestamp: ts(NOW - 3_600_000), dateKey: '20260310', securityUserId: 's', securityUserName: 'S', gateId: 'main', gateLocation: 'Main Gate', requestId: 'r' },
    unloadingCheck: null, checkOut: null, status: 'checked_in', driverOnDutyLock: true, dwellWarning: false, ...over,
  }) as WithId<Visit>

describe('matchesPass', () => {
  const f = (over: Partial<Parameters<typeof matchesPass>[1]> = {}) => ({ status: 'all' as const, range: 'all' as const, needle: '', ...over })
  it('filters by status, reading an unflipped pass past its end as expired', () => {
    const late = pass({ validUntil: ts(NOW - 1) })
    expect(matchesPass(late, f({ status: 'expired' }), NOW)).toBe(true)
    expect(matchesPass(late, f({ status: 'active' }), NOW)).toBe(false)
    expect(matchesPass(pass(), f({ status: 'active' }), NOW)).toBe(true)
    expect(matchesPass(pass({ status: 'revoked' }), f({ status: 'revoked' }), NOW)).toBe(true)
  })
  it('"Over time" means inside longer than the pass allows', () => {
    const inside = (min: number) => pass({ status: 'checked_in', checkInAt: ts(NOW - min * 60_000) })
    expect(matchesPass(inside(61), f({ status: 'over' }), NOW)).toBe(true)
    expect(matchesPass(inside(59), f({ status: 'over' }), NOW)).toBe(false)
    expect(matchesPass(pass(), f({ status: 'over' }), NOW)).toBe(false)
  })
  it('filters by date range of issue', () => {
    const old = pass({ issuedAt: ts(NOW - 10 * 86_400_000) })
    expect(matchesPass(old, f({ range: 'week' }), NOW)).toBe(false)
    expect(matchesPass(old, f({ range: 'month' }), NOW)).toBe(true)
    expect(matchesPass(pass({ issuedAt: ts(NOW - 5_000) }), f({ range: 'today' }), NOW)).toBe(true)
  })
  it('searches name, company, host, purpose and the code (typed with or without a dash)', () => {
    for (const needle of ['nimal', 'audit', 'finance', 'quarterly', 'abcdefgh', 'ABCD-EFGH', 'abcd efgh']) expect(matchesPass(pass(), f({ needle }), NOW)).toBe(true)
    expect(matchesPass(pass(), f({ needle: 'zzz' }), NOW)).toBe(false)
  })
})

describe('onSiteRows', () => {
  it('combines vehicles and visitors, longest inside first, and flags rows over their own limit', () => {
    const rows = onSiteRows(
      [visit(), visit({ checkIn: { ...visit().checkIn, timestamp: ts(NOW - 17 * 3_600_000) } }, 'vis_old')],
      [pass({ status: 'checked_in', checkInAt: ts(NOW - 90 * 60_000) }, 'vsp_over'), pass({ status: 'checked_in', checkInAt: ts(NOW - 10 * 60_000) }, 'vsp_ok'), pass({ status: 'active' }, 'vsp_not_in')],
      { dwellLimitHours: 16 },
      NOW,
      (id) => `/admin/visits/${id}`,
    )
    expect(rows.map((r) => r.key)).toEqual(['v_vis_old', 'p_vsp_over', 'v_vis_1', 'p_vsp_ok'])
    expect(rows.map((r) => r.over)).toEqual([true, true, false, false])
    expect(rows[0]).toMatchObject({ kind: 'vehicle', name: 'WP LJ-4821', limitMinutes: 960, href: '/admin/visits/vis_old' })
    expect(rows[1]).toMatchObject({ kind: 'visitor', name: 'Nimal Perera', limitMinutes: 60, detail: '→ Finance · Audit Co', href: null })
  })
  it('shows an empty site as an empty list and ignores anyone who has left', () => {
    expect(onSiteRows([], [], null, NOW)).toEqual([])
    expect(onSiteRows([visit({ status: 'checked_out' })], [pass({ status: 'checked_out', checkInAt: ts(NOW - 1000) })], null, NOW)).toEqual([])
  })
})

describe('verdictOf (what the guard sees)', () => {
  const view = (over: Partial<VisitorPassView> = {}): VisitorPassView => ({
    passId: 'vsp_1', passCode: 'ABCDEFGH', status: 'active', entry: 'ok', visitorName: 'N', organization: null, hostName: null, purposeOfVisit: 'x', photoPath: null,
    siteId: 'main', siteName: 'Main Gate', validFrom: NOW - 1000, validUntil: NOW + 1000, maxDwellMinutes: 60, checkInAt: null, checkInByName: null, checkOutAt: null, overstay: false, revokeReason: null, ...over,
  })
  const gate = { id: 'main', name: 'Main Gate' }
  it('is READY only for a valid pass at its own gate', () => {
    expect(verdictOf(view(), gate)).toMatchObject({ tone: 'go', label: 'READY TO CHECK IN' })
    expect(verdictOf(view(), null).tone).toBe('go')
  })
  it('names every way a pass cannot be used, each with its own words', () => {
    expect(verdictOf(view({ entry: 'expired' }), gate)).toMatchObject({ tone: 'stop', label: 'PASS EXPIRED' })
    expect(verdictOf(view({ status: 'expired', entry: 'expired' }), gate).label).toBe('PASS EXPIRED')
    expect(verdictOf(view({ entry: 'not-yet-valid' }), gate)).toMatchObject({ tone: 'wait', label: 'NOT VALID YET' })
    expect(verdictOf(view({ status: 'revoked', entry: 'not-active' }), gate)).toMatchObject({ tone: 'stop', label: 'PASS CANCELLED' })
    expect(verdictOf(view({ status: 'checked_out', entry: 'not-active' }), gate)).toMatchObject({ tone: 'stop', label: 'PASS ALREADY USED' })
    expect(verdictOf(view({ status: 'checked_in', entry: 'not-active' }), gate)).toMatchObject({ tone: 'info', label: 'ALREADY INSIDE' })
    expect(verdictOf(view({ siteId: 'back', siteName: 'Back Gate' }), gate)).toMatchObject({ tone: 'stop', label: 'WRONG GATE', reason: 'This pass is for Back Gate.' })
  })
})
