import { describe, expect, it } from 'vitest'
import { dateKey, isValidTimezone } from './dates'

describe('dateKey (Asia/Colombo, UTC+5:30)', () => {
  const tz = 'Asia/Colombo'
  it('is the local day just before local midnight (23:59 local = 18:29 UTC)', () => {
    expect(dateKey(tz, new Date('2026-03-10T18:29:00Z'))).toBe('20260310')
  })
  it('rolls over at local midnight (00:00 local = 18:30 UTC the day before)', () => {
    expect(dateKey(tz, new Date('2026-03-10T18:30:00Z'))).toBe('20260311')
  })
  it('is the next local day at 00:01', () => {
    expect(dateKey(tz, new Date('2026-03-10T18:31:00Z'))).toBe('20260311')
  })
  it('differs from the UTC date when UTC is still the previous day', () => {
    const d = new Date('2026-03-10T20:00:00Z') // 01:30 on the 11th in Colombo
    expect(d.toISOString().slice(0, 10).replaceAll('-', '')).toBe('20260310')
    expect(dateKey(tz, d)).toBe('20260311')
  })
  it('handles year boundaries and zero-pads', () => {
    expect(dateKey(tz, new Date('2025-12-31T18:30:00Z'))).toBe('20260101')
    expect(dateKey(tz, new Date('2026-01-05T04:00:00Z'))).toBe('20260105')
  })
  it('respects other timezones', () => {
    const d = new Date('2026-03-10T23:30:00Z')
    expect(dateKey('UTC', d)).toBe('20260310')
    expect(dateKey('America/Los_Angeles', d)).toBe('20260310')
    expect(dateKey('Pacific/Auckland', d)).toBe('20260311')
  })
  it('falls back to Asia/Colombo for an invalid timezone', () => {
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(dateKey('Not/AZone', new Date('2026-03-10T18:30:00Z'))).toBe('20260311')
  })
})
