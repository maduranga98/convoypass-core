import { describe, expect, it } from 'vitest'
import { clearanceOf, isCleared, shouldInvalidate } from './inspectionLogic.js'

describe('clearanceOf', () => {
  it('only an active approval clears a vehicle', () => {
    expect(clearanceOf({ status: 'active', result: 'approved' })).toEqual({ status: 'cleared', reason: null })
    expect(clearanceOf({ status: 'active', result: 'rejected' })).toEqual({ status: 'rejected', reason: null })
    expect(clearanceOf(null)).toEqual({ status: 'never_inspected', reason: null })
    expect(clearanceOf({ status: 'superseded', result: 'approved' })).toEqual({ status: 'never_inspected', reason: null })
  })

  it('an invalidated record needs re-inspection and keeps its reason', () => {
    for (const reason of ['penalty_issued', 'document_expired', 'manual'] as const) {
      expect(clearanceOf({ status: 'invalidated', result: 'approved', invalidatedReason: reason })).toEqual({ status: 'needs_reinspection', reason })
    }
    expect(isCleared({ status: 'invalidated', result: 'approved', invalidatedReason: 'manual' })).toBe(false)
    expect(isCleared({ status: 'active', result: 'approved' })).toBe(true)
  })
})

describe('shouldInvalidate', () => {
  const rec = (over = {}) => ({ status: 'active' as const, result: 'approved' as const, inspectedAt: 100, ...over })
  it('cancels an active approval recorded at or before the event', () => {
    expect(shouldInvalidate(rec(), 100)).toBe(true)
    expect(shouldInvalidate(rec(), 200)).toBe(true)
  })
  it('never cancels a newer inspection, a rejection or an already-cancelled one', () => {
    expect(shouldInvalidate(rec(), 99)).toBe(false)
    expect(shouldInvalidate(rec({ result: 'rejected' }), 200)).toBe(false)
    expect(shouldInvalidate(rec({ status: 'invalidated' }), 200)).toBe(false)
    expect(shouldInvalidate(null, 200)).toBe(false)
  })
})
