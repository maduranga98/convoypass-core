import { describe, expect, it } from 'vitest'
import { dateKey } from '@/lib/dates'
import { dayRange } from './gateLog'

describe('dayRange', () => {
  it('is midnight to midnight in the tenant timezone', () => {
    const { start, end } = dayRange('Asia/Colombo', '20260310')
    expect(new Date(start).toISOString()).toBe('2026-03-09T18:30:00.000Z')
    expect(end - start).toBe(24 * 3600_000)
    expect(dateKey('Asia/Colombo', new Date(start))).toBe('20260310')
    expect(dateKey('Asia/Colombo', new Date(end - 1))).toBe('20260310')
    expect(dateKey('Asia/Colombo', new Date(end))).toBe('20260311')
  })
  it('handles a DST day (23 hours) and month ends', () => {
    const { start, end } = dayRange('America/New_York', '20260308')
    expect(end - start).toBe(23 * 3600_000)
    expect(dateKey('America/New_York', new Date(start))).toBe('20260308')
    expect(dateKey('America/New_York', new Date(start - 1))).toBe('20260307')
    const feb = dayRange('Asia/Colombo', '20260228')
    expect(dateKey('Asia/Colombo', new Date(feb.end))).toBe('20260301')
  })
  it('falls back to the default timezone', () => {
    expect(dayRange('Nope/Zone', '20260310')).toEqual(dayRange('Asia/Colombo', '20260310'))
  })
})
