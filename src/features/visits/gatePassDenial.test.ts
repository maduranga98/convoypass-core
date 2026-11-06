import { describe, expect, it } from 'vitest'
import { BLOCK_REASONS } from '@/lib/gatePassLogic'
import { gatePassDenial } from './gatePassDenial'

describe('gatePassDenial', () => {
  it('says the three things differently', () => {
    expect(gatePassDenial({ state: 'none', month: '2026-11' })).toBe('No gate pass issued for this month')
    expect(gatePassDenial({ state: 'expired', month: '2026-11' })).toBe('Gate pass expired')
    expect(gatePassDenial({ state: 'blocked', month: '2026-11', reason: 'penalty' })).toBe('Gate pass blocked: penalty')
  })
  it('names every block reason', () => {
    const texts = BLOCK_REASONS.map((reason) => gatePassDenial({ state: 'blocked', month: '2026-11', reason }))
    expect(new Set(texts).size).toBe(BLOCK_REASONS.length)
    for (const t of texts) expect(t).toMatch(/^Gate pass blocked: \w/)
  })
})
