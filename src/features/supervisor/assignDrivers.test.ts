import { describe, expect, it } from 'vitest'
import { attentionReasons } from './assignDrivers'

const drivers = new Map([['d1', { status: 'active' as const }], ['d2', { status: 'disabled' as const }]])
const v = (assignedDriverIds: string[], status: 'active' | 'suspended' = 'active') => ({ id: 'v1', assignedDriverIds, status })

describe('attentionReasons', () => {
  it('flags a vehicle without an active driver', () => {
    expect(attentionReasons(v([]), drivers, new Set())).toEqual(['no-driver'])
    expect(attentionReasons(v(['d2']), drivers, new Set())).toEqual(['no-driver'])
  })
  it('flags a rejected pass', () => {
    expect(attentionReasons(v(['d1']), drivers, new Set(['v1']))).toEqual(['rejected'])
  })
  it('is empty for a fine or suspended vehicle', () => {
    expect(attentionReasons(v(['d1']), drivers, new Set())).toEqual([])
    expect(attentionReasons(v([], 'suspended'), drivers, new Set(['v1']))).toEqual([])
  })
})
