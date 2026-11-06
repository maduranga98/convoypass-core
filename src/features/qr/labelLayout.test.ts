import { describe, expect, it } from 'vitest'
import { chunk, LABEL_SPEC, labelsPerPage, plateFontMm } from './labelLayout'

describe('label layout', () => {
  it('holds 2x3 large and 3x5 small labels per A4 page', () => {
    expect(labelsPerPage('large')).toBe(6)
    expect(labelsPerPage('small')).toBe(15)
  })

  it.each(['large', 'small'] as const)('%s grid fits the 190 x 277 mm printable area', (size) => {
    const s = LABEL_SPEC[size]
    expect(s.cols * s.mm + (s.cols - 1) * s.gap).toBeLessThanOrEqual(190)
    expect(s.rows * s.mm + (s.rows - 1) * s.gap).toBeLessThanOrEqual(277)
  })

  it('large labels are about 90 mm and small about 50 mm', () => {
    expect(LABEL_SPEC.large.mm).toBe(90)
    expect(LABEL_SPEC.small.mm).toBe(50)
  })

  it('splits labels into pages of the right size', () => {
    const pages = chunk(Array.from({ length: 14 }, (_, i) => i), labelsPerPage('large'))
    expect(pages.map((p) => p.length)).toEqual([6, 6, 2])
    expect(chunk([], 6)).toEqual([])
  })

  it('shrinks long plates so they stay inside the label, never exceeding the maximum', () => {
    for (const size of ['large', 'small'] as const) {
      const s = LABEL_SPEC[size]
      for (const plate of ['CAB-1234', 'WP LJ-4821', 'ABCDEFGHIJKL', 'AB CD-EF GH-IJ KL']) {
        const font = plateFontMm(plate, size)
        expect(font).toBeLessThanOrEqual(s.plateMax)
        expect(font * 0.64 * plate.length).toBeLessThanOrEqual(s.mm - s.pad * 2)
      }
      expect(plateFontMm('CAB-1234', size)).toBe(s.plateMax)
    }
  })
})
