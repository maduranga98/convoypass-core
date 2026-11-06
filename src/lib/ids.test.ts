import { describe, expect, it } from 'vitest'
import { newInspectionId, newPenaltyId } from './ids'

describe('newPenaltyId', () => {
  it('matches the server pattern and does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newPenaltyId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^pen_[a-z0-9]{10}$/)
  })
})

describe('newInspectionId', () => {
  it('matches the server pattern and does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newInspectionId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^insp_[a-z0-9]{10}$/)
  })
})
