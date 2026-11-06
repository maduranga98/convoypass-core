import { describe, expect, it } from 'vitest'
import type { EligibilityResult } from '@/types/penalties'
import { deniedReasons } from './reasons'

const base: EligibilityResult = {
  status: 'valid', blocked: false, vehicle: null, driver: null,
  inspection: { status: 'cleared', cleared: true, reason: null, at: 1 }, eligible: true, checkedAt: 1,
}

describe('deniedReasons', () => {
  it('names every layer that blocks, straight from the shared check', () => {
    const e: EligibilityResult = {
      ...base, status: 'blocked', blocked: true, eligible: false,
      vehicle: { id: 'v', documentStatus: 'expired', blocked: true, penalties: [{ id: 'p', typeName: 'Damage', permanent: true, endDate: null }] },
      driver: { id: 'd', documentStatus: 'expired', blocked: true, penalties: [{ id: 'q', typeName: 'Speeding', permanent: false, endDate: Date.UTC(2030, 0, 15, 12) }] },
      inspection: { status: 'needs_reinspection', cleared: false, reason: 'penalty_issued', at: 5 },
    }
    const out = deniedReasons(e)
    expect(out).toEqual([
      'Vehicle documents expired',
      'Driver licence expired',
      'Vehicle suspended: Damage',
      expect.stringMatching(/^Driver suspended: Speeding, until /),
      'Needs re-inspection: a penalty was issued',
    ])
  })

  it('covers never inspected and a failed inspection', () => {
    expect(deniedReasons({ ...base, eligible: false, inspection: { status: 'never_inspected', cleared: false, reason: null, at: null } })).toEqual(['Vehicle not inspected'])
    expect(deniedReasons({ ...base, eligible: false, inspection: { status: 'rejected', cleared: false, reason: null, at: 1 } })).toEqual(['Vehicle failed inspection'])
  })

  it('never returns an empty list for a refusal', () => {
    expect(deniedReasons({ ...base, eligible: false })).toEqual(['Not eligible'])
  })
})
