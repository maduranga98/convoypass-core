import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/expiry'
import * as web from './expiry'

const today = '2026-10-22'

describe('computeEligibility', () => {
  it('is valid when nothing is tracked or every date is far away', () => {
    expect(web.computeEligibility([], today, 14)).toBe('valid')
    expect(web.computeEligibility([null, undefined], today, 14)).toBe('valid')
    expect(web.computeEligibility(['2026-11-30', '2027-01-01'], today, 14)).toBe('valid')
  })

  it('is not expired through the whole expiry day, and expired the day after', () => {
    expect(web.computeEligibility(['2026-10-22'], today, 0)).toBe('expiringSoon')
    expect(web.computeEligibility(['2026-10-21'], today, 14)).toBe('expired')
  })

  it('is expiring soon inside the window, edges included', () => {
    expect(web.computeEligibility(['2026-10-22'], today, 14)).toBe('expiringSoon')
    expect(web.computeEligibility(['2026-11-05'], today, 14)).toBe('expiringSoon')
    expect(web.computeEligibility(['2026-11-06'], today, 14)).toBe('valid')
  })

  it('takes the worst date, and expired beats expiring soon', () => {
    expect(web.computeEligibility(['2027-01-01', '2026-10-25'], today, 14)).toBe('expiringSoon')
    expect(web.computeEligibility(['2026-10-25', '2026-10-01'], today, 14)).toBe('expired')
  })

  it('ignores malformed dates instead of throwing', () => {
    expect(web.computeEligibility(['2026-13-45', 'tomorrow'], today, 14)).toBe('valid')
  })

  it('crosses month and year ends correctly', () => {
    expect(web.daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(web.daysUntil('2028-03-01', '2028-02-28')).toBe(2) // leap year
  })
})

describe('helpers', () => {
  it('validates calendar dates', () => {
    expect(web.isExpiryDate('2026-02-29')).toBe(false)
    expect(web.isExpiryDate('2028-02-29')).toBe(true)
    expect(web.isExpiryDate('2026-1-1')).toBe(false)
    expect(web.isoFromDateKey('20261022')).toBe('2026-10-22')
  })

  it('falls back to the default window', () => {
    expect(web.warningDaysOf(undefined)).toBe(14)
    expect(web.warningDaysOf(0)).toBe(14)
    expect(web.warningDaysOf(91)).toBe(14)
    expect(web.warningDaysOf(30)).toBe(30)
  })

  it('is identical in the web and functions copies', () => {
    expect(web.DEFAULT_EXPIRY_WARNING_DAYS).toBe(fn.DEFAULT_EXPIRY_WARNING_DAYS)
    expect(web.MIN_EXPIRY_WARNING_DAYS).toBe(fn.MIN_EXPIRY_WARNING_DAYS)
    expect(web.MAX_EXPIRY_WARNING_DAYS).toBe(fn.MAX_EXPIRY_WARNING_DAYS)
    expect(web.ELIGIBILITY_STATUSES).toEqual(fn.ELIGIBILITY_STATUSES)
    for (const dates of [['2026-10-22'], ['2026-10-21'], ['2027-01-01'], []]) {
      expect(web.computeEligibility(dates, today, 14)).toBe(fn.computeEligibility(dates, today, 14))
    }
  })
})
