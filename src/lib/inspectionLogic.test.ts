import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/inspectionLogic'
import * as web from './inspectionLogic'

describe('inspection logic', () => {
  it('exports the same constants and behaves identically in the web and functions copies', () => {
    for (const k of ['INSPECTION_RESULTS', 'INSPECTION_STATUSES', 'INVALIDATION_REASONS', 'CLEARANCE_STATUSES', 'INSPECTION_NOTES_MAX', 'REJECTION_NOTE_MIN'] as const) {
      expect(web[k]).toEqual(fn[k])
    }
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())
    for (const status of fn.INSPECTION_STATUSES) {
      for (const result of fn.INSPECTION_RESULTS) {
        for (const invalidatedReason of [...fn.INVALIDATION_REASONS, null]) {
          const rec = { status, result, invalidatedReason, inspectedAt: 100 }
          expect(web.clearanceOf(rec)).toEqual(fn.clearanceOf(rec))
          expect(web.isCleared(rec)).toBe(fn.isCleared(rec))
          for (const at of [99, 100, 101]) expect(web.shouldInvalidate(rec, at)).toBe(fn.shouldInvalidate(rec, at))
        }
      }
    }
    expect(web.clearanceOf(null)).toEqual(fn.clearanceOf(null))
  })
})
