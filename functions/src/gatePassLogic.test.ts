import { describe, expect, it } from 'vitest'
import {
  badgeStatusOf,
  blockReasonForClearance,
  daysInMonth,
  gatePassCheck,
  gatePassId,
  inQualificationWindow,
  isBlockable,
  isReactivatable,
  isValidMonth,
  issuableMonths,
  monthOfDateKey,
  nextMonth,
} from './gatePassLogic.js'

describe('months', () => {
  it('reads the month from a day key and rolls the year over', () => {
    expect(monthOfDateKey('20261104')).toBe('2026-11')
    expect(nextMonth('2026-11')).toBe('2026-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(issuableMonths('2026-12')).toEqual(['2026-12', '2027-01'])
  })
  it('validates the month format', () => {
    expect(isValidMonth('2026-11')).toBe(true)
    for (const bad of ['2026-13', '2026-00', '26-11', '2026-1', '202611', '', null, 5]) expect(isValidMonth(bad)).toBe(false)
  })
  it('knows the length of a month, leap years included', () => {
    expect(daysInMonth('2024-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-11')).toBe(30)
  })
  it('the qualification window is the last four days of the month', () => {
    expect(inQualificationWindow('20261126')).toBe(false)
    expect(inQualificationWindow('20261127')).toBe(true)
    expect(inQualificationWindow('20261130')).toBe(true)
    expect(inQualificationWindow('20260225')).toBe(true)
    expect(inQualificationWindow('20260224')).toBe(false)
  })
  it('the pass id is the pairing, so a pairing can never hold two passes in a month', () => {
    expect(gatePassId('2026-11', 'veh_a', 'drv1')).toBe('2026-11_veh_a_drv1')
  })
})

describe('block rules', () => {
  it('only an active pass of this month or later is blocked or listed as blockable', () => {
    expect(isBlockable({ status: 'active', month: '2026-11' }, '2026-11')).toBe(true)
    expect(isBlockable({ status: 'active', month: '2026-12' }, '2026-11')).toBe(true)
    expect(isBlockable({ status: 'active', month: '2026-10' }, '2026-11')).toBe(false)
    expect(isBlockable({ status: 'blocked', month: '2026-11' }, '2026-11')).toBe(false)
    expect(isBlockable({ status: 'expired', month: '2026-11' }, '2026-11')).toBe(false)
  })
  it('only a blocked pass of this month or later can be reactivated', () => {
    expect(isReactivatable({ status: 'blocked', month: '2026-11' }, '2026-11')).toBe(true)
    expect(isReactivatable({ status: 'blocked', month: '2026-10' }, '2026-11')).toBe(false)
    expect(isReactivatable({ status: 'expired', month: '2026-11' }, '2026-11')).toBe(false)
    expect(isReactivatable({ status: 'active', month: '2026-11' }, '2026-11')).toBe(false)
  })
  it('a cancelled inspection keeps the cause that cancelled it', () => {
    expect(blockReasonForClearance('penalty_issued')).toBe('penalty')
    expect(blockReasonForClearance('document_expired')).toBe('document_expired')
    expect(blockReasonForClearance('manual')).toBe('inspection_invalidated')
    expect(blockReasonForClearance(null)).toBe('inspection_invalidated')
  })
})

describe('gatePassCheck', () => {
  it('lets only an active pass through', () => {
    expect(gatePassCheck({ status: 'active' }, false, '2026-11')).toEqual({ state: 'active' })
  })
  it('three distinct reasons for the guard', () => {
    expect(gatePassCheck(null, false, '2026-11')).toEqual({ state: 'none', month: '2026-11' })
    expect(gatePassCheck({ status: 'blocked', blockedReason: 'penalty' }, false, '2026-11')).toEqual({ state: 'blocked', month: '2026-11', reason: 'penalty' })
    expect(gatePassCheck(null, true, '2026-11')).toEqual({ state: 'expired', month: '2026-11' })
    expect(gatePassCheck({ status: 'expired' }, false, '2026-11')).toEqual({ state: 'expired', month: '2026-11' })
  })
})

describe('badgeStatusOf', () => {
  it('shows the best status among the month’s passes, or not issued', () => {
    expect(badgeStatusOf([])).toBe('not_issued')
    expect(badgeStatusOf([{ status: 'blocked' }, { status: 'active' }])).toBe('active')
    expect(badgeStatusOf([{ status: 'expired' }, { status: 'blocked' }])).toBe('blocked')
    expect(badgeStatusOf([{ status: 'expired' }])).toBe('expired')
  })
})
