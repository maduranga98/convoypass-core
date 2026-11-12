import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  dwellMinutes,
  effectiveStatus,
  entryCheck,
  formatPassCode,
  idKeyOf,
  isOverstay,
  monthlyCap,
  normalisePassCode,
  parseVisitorQr,
  planOf,
  validityWindow,
  visitorQrPayload,
  visitorSettingsOf,
  yearMonthOf,
} from './visitorLogic.js'

// 2023-11-14 22:13:20 UTC = 2023-11-15 03:43 in Colombo.
const NOW = 1_700_000_000_000
const TZ = 'Asia/Colombo'

describe('plan cap', () => {
  it('caps Starter at 20 and leaves the other plans unlimited', () => {
    expect(monthlyCap('starter')).toBe(20)
    expect(monthlyCap('growth')).toBeNull()
    expect(monthlyCap('compliance')).toBeNull()
  })
  it('does not cap a company with no plan recorded, and caps an unknown plan value', () => {
    expect(planOf(null)).toBe('growth')
    expect(planOf({})).toBe('growth')
    expect(planOf({ plan: 'starter' })).toBe('starter')
    expect(planOf({ plan: 'platinum' })).toBe('starter')
  })
  it('counts a pass in the month of the company timezone', () => {
    // 22:13 UTC on 30 Nov is already 1 Dec in Colombo.
    expect(yearMonthOf(TZ, new Date('2023-11-30T22:13:00Z'))).toBe('202312')
    expect(yearMonthOf('UTC', new Date('2023-11-30T22:13:00Z'))).toBe('202311')
  })
})

describe('settings', () => {
  it('falls back to the defaults for anything absent or out of range', () => {
    expect(visitorSettingsOf(null)).toEqual({ maxDwellMinutes: 480, defaultValidDays: 1 })
    expect(visitorSettingsOf({ visitorSettings: { maxDwellMinutes: 5, defaultValidDays: 99 } })).toEqual({ maxDwellMinutes: 480, defaultValidDays: 1 })
    expect(visitorSettingsOf({ visitorSettings: { maxDwellMinutes: 120, defaultValidDays: 3 } })).toEqual({ maxDwellMinutes: 120, defaultValidDays: 3 })
  })
})

describe('pass codes', () => {
  it('normalises case, spaces and dashes and rejects anything else', () => {
    expect(normalisePassCode('abcd-efgh')).toBe('ABCDEFGH')
    expect(normalisePassCode(' abcd efgh ')).toBe('ABCDEFGH')
    expect(normalisePassCode('ABCDEFG')).toBeNull()
    expect(normalisePassCode('ABCDEFG0')).toBeNull() // 0, O, 1 and I are never in a code
    expect(normalisePassCode('ABCDEFGI')).toBeNull()
    expect(formatPassCode('ABCDEFGH')).toBe('ABCD-EFGH')
  })
  it('reads a QR of ours (or a bare code) and refuses look-alikes', () => {
    const base = 'https://app.example.com'
    expect(parseVisitorQr(visitorQrPayload(base, 'ABCDEFGH'), base)).toBe('ABCDEFGH')
    expect(parseVisitorQr('https://app.example.com/vp/ABCDEFGH/', base)).toBe('ABCDEFGH')
    expect(parseVisitorQr('ABCD-EFGH', base)).toBe('ABCDEFGH')
    expect(parseVisitorQr('https://evil.example.com/vp/ABCDEFGH', base)).toBeNull()
    expect(parseVisitorQr('https://app.example.com/v/veh_aaaaaaaaaa', base)).toBeNull()
    expect(parseVisitorQr('https://app.example.com/vp/ABCDEFGH', null)).toBeNull()
    expect(parseVisitorQr('hello', base)).toBeNull()
  })
})

describe('validity window', () => {
  it('defaults to today, for one day', () => {
    const w = validityWindow(TZ, NOW, {}, 1)
    expect(w).toMatchObject({ ok: true, fromDate: '2023-11-15', untilDate: '2023-11-15' })
    if (!w.ok) return
    // Colombo is UTC+5:30: the day runs 2023-11-14T18:30Z .. 2023-11-15T18:29:59.999Z.
    expect(w.from).toBe(Date.parse('2023-11-14T18:30:00Z'))
    expect(w.until).toBe(Date.parse('2023-11-15T18:30:00Z') - 1)
  })
  it('uses the default number of days and explicit dates', () => {
    expect(validityWindow(TZ, NOW, {}, 3)).toMatchObject({ ok: true, untilDate: '2023-11-17' })
    expect(validityWindow(TZ, NOW, { validFrom: '2023-11-20', validUntil: '2023-11-22' }, 1)).toMatchObject({ ok: true, fromDate: '2023-11-20', untilDate: '2023-11-22' })
  })
  it('refuses the past, an end before the start, a span over 30 days and a start too far ahead', () => {
    expect(validityWindow(TZ, NOW, { validFrom: '2023-11-14' }, 1)).toEqual({ ok: false })
    expect(validityWindow(TZ, NOW, { validFrom: '2023-11-20', validUntil: '2023-11-19' }, 1)).toEqual({ ok: false })
    expect(validityWindow(TZ, NOW, { validUntil: '2023-12-31' }, 1)).toEqual({ ok: false })
    expect(validityWindow(TZ, NOW, { validFrom: '2024-03-01' }, 1)).toEqual({ ok: false })
    expect(validityWindow(TZ, NOW, { validFrom: 'nope' }, 1)).toEqual({ ok: false })
  })
  it('adds days across month ends', () => {
    expect(addDaysIso('2023-11-30', 1)).toBe('2023-12-01')
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('what a pass is right now', () => {
  const pass = { status: 'active' as const, validFrom: 1000, validUntil: 2000, checkInAt: null, maxDwellMinutes: 60 }
  it('reads an active pass past its end as expired, even before the schedule flips it', () => {
    expect(effectiveStatus(pass, 1500)).toBe('active')
    expect(effectiveStatus(pass, 2001)).toBe('expired')
    expect(effectiveStatus({ ...pass, status: 'checked_in' }, 2001)).toBe('checked_in')
  })
  it('allows entry only for an active pass inside its window (the last millisecond included)', () => {
    expect(entryCheck(pass, 999)).toBe('not-yet-valid')
    expect(entryCheck(pass, 1000)).toBe('ok')
    expect(entryCheck(pass, 2000)).toBe('ok')
    expect(entryCheck(pass, 2001)).toBe('expired')
    expect(entryCheck({ ...pass, status: 'expired' }, 1500)).toBe('expired')
    for (const status of ['checked_in', 'checked_out', 'revoked'] as const) expect(entryCheck({ ...pass, status }, 1500)).toBe('not-active')
  })
  it('flags a stay over the limit and never a stay that is not checked in', () => {
    const inside = { status: 'checked_in' as const, checkInAt: NOW, maxDwellMinutes: 60 }
    expect(dwellMinutes(NOW, NOW + 61 * 60_000)).toBe(61)
    expect(dwellMinutes(NOW, NOW - 5)).toBe(0)
    expect(isOverstay(inside, NOW + 60 * 60_000)).toBe(false)
    expect(isOverstay(inside, NOW + 61 * 60_000)).toBe(true)
    expect(isOverstay({ ...inside, status: 'checked_out' as never }, NOW + 999 * 60_000)).toBe(false)
  })
})

describe('id key', () => {
  it('keeps letters and digits, uppercased, and needs four', () => {
    expect(idKeyOf('19-85 123v')).toBe('1985123V')
    expect(idKeyOf('12')).toBeNull()
    expect(idKeyOf(null)).toBeNull()
  })
})
