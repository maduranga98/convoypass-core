import { describe, expect, it } from 'vitest'
import { compareCounts, formatComparison } from './restoreCheck.ts'

describe('compareCounts', () => {
  const live = { users: 10, passes: 1000, auditLog: 5000 }
  it('is ok when every collection matches', () => {
    expect(compareCounts(live, { ...live }).ok).toBe(true)
  })
  it('flags a lost collection and a missing one', () => {
    const c = compareCounts(live, { users: 10, passes: 990 })
    expect(c.ok).toBe(false)
    expect(c.rows.find((r) => r.collection === 'passes')).toMatchObject({ diff: -10, ok: false })
    expect(c.rows.find((r) => r.collection === 'auditLog')).toMatchObject({ actual: 0, diff: -5000, ok: false })
  })
  it('accepts a difference within the tolerance (writes since the snapshot)', () => {
    expect(compareCounts(live, { users: 10, passes: 1003, auditLog: 5012 }, 20).ok).toBe(true)
    expect(compareCounts(live, { users: 10, passes: 1003, auditLog: 5012 }, 5).ok).toBe(false)
  })
  it('prints a readable table', () => {
    const text = formatComparison(compareCounts(live, { users: 9, passes: 1000, auditLog: 5000 }))
    expect(text).toContain('collection')
    expect(text).toMatch(/users\s+10\s+9\s+-1\s+MISMATCH/)
    expect(text).toMatch(/passes\s+1000\s+1000\s+\+0\s+ok/)
  })
})
