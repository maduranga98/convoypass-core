import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/requirementLogic'
import * as web from './requirementLogic'

describe('requirement logic', () => {
  it('exports the same names and behaves identically in the web and functions copies', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())
    expect(web.DEFAULT_QUALIFICATION_TYPES).toEqual(fn.DEFAULT_QUALIFICATION_TYPES)
    for (const iso of ['2026-02-28', '2024-02-29', '2026-10-31', '2026-12-15']) {
      for (const n of [3, 12]) expect(web.addMonths(iso, n)).toBe(fn.addMonths(iso, n))
    }
    const records = { safety: { expiresOn: '2026-11-01' } as web.QualificationRecord, defensive_driving: { expiresOn: '2026-01-01' } as web.QualificationRecord }
    expect(web.qualificationStanding(web.DEFAULT_QUALIFICATION_TYPES, records, '2026-10-27', 14)).toEqual(
      fn.qualificationStanding(fn.DEFAULT_QUALIFICATION_TYPES, records, '2026-10-27', 14),
    )
    for (const d of [null, '2026-10-26', '2026-10-27', '2026-11-10', '2026-12-01']) {
      expect(web.annualInspectionState(d, '2026-10-27', 14)).toBe(fn.annualInspectionState(d, '2026-10-27', 14))
    }
  })
})

describe('qualifications', () => {
  it('are valid for one year, clamping leap days', () => {
    expect(fn.qualificationExpiry('2026-10-27')).toBe('2027-10-27')
    expect(fn.qualificationExpiry('2024-02-29')).toBe('2025-02-28')
  })

  it('lists missing and expired required types, and requires nothing from an empty list', () => {
    const types = fn.DEFAULT_QUALIFICATION_TYPES
    const s = fn.qualificationStanding(types, { safety: { expiresOn: '2026-10-27' } as fn.QualificationRecord, work_instruction: { expiresOn: '2026-10-26' } as fn.QualificationRecord }, '2026-10-27', 14)
    expect(s).toEqual({ missing: ['Defensive driving (DD)'], expired: ['Work instruction'], ok: false })
    expect(fn.qualificationStanding([], undefined, '2026-10-27', 14).ok).toBe(true)
  })
})

describe('annual inspection', () => {
  it('needs a date, and is valid through the whole expiry day', () => {
    expect(fn.annualInspectionState(undefined, '2026-10-27', 14)).toBe('missing')
    expect(fn.annualInspectionState('2026-10-26', '2026-10-27', 14)).toBe('expired')
    expect(fn.annualInspectionState('2026-10-27', '2026-10-27', 14)).toBe('expiringSoon')
    expect(fn.annualInspectionOk(fn.annualInspectionState('2027-01-01', '2026-10-27', 14))).toBe(true)
    expect(fn.annualInspectionOk('missing')).toBe(false)
  })
})

describe('permits', () => {
  it('are valid for three months and normalised', () => {
    expect(fn.permitExpiry('2026-10-31')).toBe('2027-01-31')
    expect(fn.normalisePermitNumber('  ab  123 ')).toBe('AB 123')
    expect(fn.permitState({ expiresOn: '2026-10-26' }, '2026-10-27', 14)).toBe('expired')
  })
})
