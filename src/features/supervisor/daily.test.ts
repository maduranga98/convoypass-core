import { describe, expect, it } from 'vitest'
import { dailyCounts, inputFromKey, keyFromInput } from './daily'

const p = (status: Parameters<typeof dailyCounts>[0][number]['status'], stage?: 'supervisor' | 'officer' | 'revoked') =>
  ({ status, ...(stage ? { rejection: { stage } } : {}) }) as Parameters<typeof dailyCounts>[0][number]

describe('dailyCounts', () => {
  it('counts vehicles in, rejected and waiting', () => {
    const c = dailyCounts([p('submitted'), p('supervisor_approved'), p('officer_approved'), p('checked_in'), p('rejected', 'supervisor'), p('rejected', 'officer')])
    expect(c).toEqual({ total: 6, approved: 3, rejected: 2, waiting: 1, rejectedBySupervisor: 1 })
  })
  it('is zero for an empty day', () => {
    expect(dailyCounts([])).toEqual({ total: 0, approved: 0, rejected: 0, waiting: 0, rejectedBySupervisor: 0 })
  })
  it('converts date keys', () => {
    expect(keyFromInput('2026-03-09')).toBe('20260309')
    expect(inputFromKey('20260309')).toBe('2026-03-09')
  })
})
