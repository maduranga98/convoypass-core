import { describe, expect, it } from 'vitest'
import { matchesVisit, recentLocations } from './filters'

const ts = (ms: number) => ({ toMillis: () => ms }) as never
const unloaded = (place: string | null, at: number) =>
  ({ unloadingCheck: { performed: true, timestamp: ts(at), dateKey: 'x', officerUserId: 'u', officerName: 'n', unloaded: place !== null, unloadLocation: place } }) as never

describe('matchesVisit', () => {
  const v = { plateNo: 'WP LJ-4821', driverName: 'Dan Driver' }
  it('finds a plate ignoring spaces, dashes and case, or part of a driver name', () => {
    for (const q of ['', 'wplj', 'lj 4821', '4821', 'dan', 'DRIVER']) expect(matchesVisit(v, q)).toBe(true)
    for (const q of ['cab', 'bob']) expect(matchesVisit(v, q)).toBe(false)
  })
})

describe('recentLocations', () => {
  it('lists each place once, most recently used first, and skips visits without one', () => {
    const out = recentLocations([unloaded('Bay 3', 10), unloaded('Store A', 30), unloaded('Bay 3', 20), unloaded(null, 40), { unloadingCheck: null }])
    expect(out).toEqual(['Store A', 'Bay 3'])
  })
  it('caps the list', () => {
    expect(recentLocations(Array.from({ length: 10 }, (_, i) => unloaded(`Bay ${i}`, i)), 3)).toHaveLength(3)
  })
})
