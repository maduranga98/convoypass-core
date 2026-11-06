import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/gatePassLogic'
import * as web from './gatePassLogic'

describe('gate pass logic', () => {
  it('exports the same constants and behaves identically in the web and functions copies', () => {
    for (const k of ['GATE_PASS_STATUSES', 'BLOCK_REASONS', 'MANUAL_BLOCK_NOTE_MIN', 'MANUAL_BLOCK_NOTE_MAX', 'QUALIFICATION_WINDOW_DAYS'] as const) {
      expect(web[k]).toEqual(fn[k])
    }
    expect(web.MONTH_PATTERN.source).toBe(fn.MONTH_PATTERN.source)
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())

    for (const m of ['2026-01', '2026-02', '2024-02', '2026-11', '2026-12', 'x', '2026-13']) {
      expect(web.isValidMonth(m)).toBe(fn.isValidMonth(m))
    }
    for (const m of ['2026-01', '2026-02', '2024-02', '2026-11', '2026-12']) {
      expect(web.nextMonth(m)).toBe(fn.nextMonth(m))
      expect(web.daysInMonth(m)).toBe(fn.daysInMonth(m))
      expect(web.issuableMonths(m)).toEqual(fn.issuableMonths(m))
    }
    for (const k of ['20260101', '20260227', '20260228', '20240226', '20261126', '20261127', '20261231']) {
      expect(web.monthOfDateKey(k)).toBe(fn.monthOfDateKey(k))
      expect(web.inQualificationWindow(k)).toBe(fn.inQualificationWindow(k))
    }
    expect(web.gatePassId('2026-11', 'veh_a', 'd1')).toBe(fn.gatePassId('2026-11', 'veh_a', 'd1'))
    expect(web.pairingKey('veh_a', 'd1')).toBe(fn.pairingKey('veh_a', 'd1'))
    expect(web.qualificationId('T', '2026-11')).toBe(fn.qualificationId('T', '2026-11'))
    for (const reason of ['penalty_issued', 'document_expired', 'manual', null, undefined] as const) {
      expect(web.blockReasonForClearance(reason)).toBe(fn.blockReasonForClearance(reason))
    }
    for (const status of fn.GATE_PASS_STATUSES) {
      for (const month of ['2026-10', '2026-11', '2026-12']) {
        const p = { status, month }
        expect(web.isBlockable(p, '2026-11')).toBe(fn.isBlockable(p, '2026-11'))
        expect(web.isReactivatable(p, '2026-11')).toBe(fn.isReactivatable(p, '2026-11'))
      }
      for (const blockedReason of [...fn.BLOCK_REASONS, null]) {
        for (const earlier of [true, false]) {
          expect(web.gatePassCheck({ status, blockedReason }, earlier, '2026-11')).toEqual(fn.gatePassCheck({ status, blockedReason }, earlier, '2026-11'))
        }
      }
    }
    for (const earlier of [true, false]) expect(web.gatePassCheck(null, earlier, '2026-11')).toEqual(fn.gatePassCheck(null, earlier, '2026-11'))
    for (const list of [[], [{ status: 'expired' }], [{ status: 'blocked' }, { status: 'expired' }], [{ status: 'active' }, { status: 'blocked' }]] as const) {
      expect(web.badgeStatusOf(list)).toBe(fn.badgeStatusOf(list))
    }
  })
})
