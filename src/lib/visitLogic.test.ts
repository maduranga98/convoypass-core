import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/visitLogic'
import * as web from './visitLogic'

const HOUR = 3_600_000

describe('visit logic', () => {
  it('exports the same constants and behaves identically in the web and functions copies', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())
    for (const k of ['VISIT_STATUSES', 'DEFAULT_DWELL_LIMIT_HOURS', 'MIN_DWELL_LIMIT_HOURS', 'MAX_DWELL_LIMIT_HOURS', 'UNLOAD_LOCATION_MIN', 'UNLOAD_LOCATION_MAX', 'SUMMARY_METRICS', 'SUMMARY_BY_ROLE'] as const) {
      expect(web[k]).toEqual(fn[k])
    }
    for (const h of [undefined, 0, 1, 16, 24, 72, 73, 1.5, Number.NaN]) {
      expect(web.dwellLimitHoursOf({ dwellLimitHours: h })).toBe(fn.dwellLimitHoursOf({ dwellLimitHours: h }))
      expect(web.dwellLimitOk(h as number)).toBe(fn.dwellLimitOk(h as number))
    }
    for (const status of ['checked_in', 'checked_out'] as const) {
      for (const now of [0, 15 * HOUR, 16 * HOUR, 17 * HOUR]) {
        expect(web.isDwellExceeded({ status, checkInAt: 0 }, now, 16)).toBe(fn.isDwellExceeded({ status, checkInAt: 0 }, now, 16))
      }
    }
    for (const role of ['admin', 'officer', 'supervisor', 'safety', 'security', 'yard', 'driver']) {
      expect(web.summaryMetricsFor(role)).toEqual(fn.summaryMetricsFor(role))
    }
  })

  it('gate time runs from the first check-in and is identical in both copies', () => {
    for (const now of [0, 15 * HOUR, 16 * HOUR - 1, 16 * HOUR, 40 * HOUR]) {
      expect(web.withinGateTime(0, now, 16)).toBe(fn.withinGateTime(0, now, 16))
    }
    expect(web.withinGateTime(0, 16 * HOUR - 1, 16)).toBe(true)
    expect(web.withinGateTime(0, 16 * HOUR, 16)).toBe(false)
    expect(web.gateTimeEndsAt(5 * HOUR, 16)).toBe(21 * HOUR)
  })

  it('the dwell limit is a company setting that defaults to 16 hours', () => {
    expect(web.dwellLimitHoursOf(null)).toBe(16)
    expect(web.dwellLimitHoursOf({})).toBe(16)
    expect(web.dwellLimitHoursOf({ dwellLimitHours: 24 })).toBe(24)
    expect(web.dwellLimitHoursOf({ dwellLimitHours: 500 })).toBe(16)
  })

  it('a visit is overdue from the limit onward, measured from check-in, and only while it is checked in', () => {
    expect(web.isDwellExceeded({ status: 'checked_in', checkInAt: 0 }, 16 * HOUR - 1, 16)).toBe(false)
    expect(web.isDwellExceeded({ status: 'checked_in', checkInAt: 0 }, 16 * HOUR, 16)).toBe(true)
    expect(web.isDwellExceeded({ status: 'checked_out', checkInAt: 0 }, 40 * HOUR, 16)).toBe(false)
  })

  it('a driver gets no summary at all', () => {
    expect(web.summaryMetricsFor('driver')).toEqual([])
  })
})
