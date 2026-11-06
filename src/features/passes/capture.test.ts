import { describe, expect, it } from 'vitest'
import { fitWithin } from './capture'

describe('fitWithin', () => {
  it('keeps small images as they are', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1200)).toEqual({ width: 1600, height: 1200 })
  })
  it('limits the longest side to 1600 px, keeping the ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(1920, 1080)).toEqual({ width: 1600, height: 900 })
  })
})
