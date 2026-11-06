import { describe, expect, it } from 'vitest'
import { formatLocalDateTime, stampText } from './stamp'

describe('stamp text', () => {
  const d = new Date(2026, 2, 5, 7, 4, 9) // local time: 5 March 2026, 07:04:09
  it('formats local date and time with zero padding', () => {
    expect(formatLocalDateTime(d)).toBe('2026-03-05 07:04:09')
  })
  it('puts the plate first', () => {
    expect(stampText('WP LJ-4821', d)).toBe('WP LJ-4821  2026-03-05 07:04:09')
  })
  it('handles midnight and the end of the day', () => {
    expect(formatLocalDateTime(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31 00:00:00')
    expect(formatLocalDateTime(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59:59')
  })
})
