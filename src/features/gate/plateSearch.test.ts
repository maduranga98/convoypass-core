import { describe, expect, it } from 'vitest'
import { normalisePlate, plateSearchKey } from '@/lib/plate'
import { searchPlates } from './plateSearch'

const v = (plateNo: string) => ({ plateNo, plateKey: normalisePlate(plateNo)?.plateKey ?? '' })
const fleet = ['WP LJ-4821', 'NP KA 1234', 'CAB-1234', 'WP CBA-5521', '250-1234', 'SP KB-9087', 'WP 4821-XY'].map(v)
const plates = (q: string, max?: number) => searchPlates(fleet, q, max).map((x) => x.plateNo)

describe('plate search', () => {
  it('uses the same normalisation as plateKey', () => {
    for (const p of ['wp lj - 4821', 'CAB-1234', '250 1234']) expect(plateSearchKey(p)).toBe(normalisePlate(p)?.plateKey)
    expect(plateSearchKey('48')).toBe('48')
  })
  it('finds a vehicle by its last 4 digits, the one ending with them first', () => {
    expect(plates('4821')).toEqual(['WP LJ-4821', 'WP 4821-XY'])
    expect(plates('9087')).toEqual(['SP KB-9087'])
  })
  it('ignores spaces, hyphens and case', () => {
    expect(plates('lj 48')).toEqual(['WP LJ-4821'])
    expect(plates('lj-4821')).toEqual(['WP LJ-4821'])
    expect(plates(' c a b - 1 2 ')).toEqual(['CAB-1234'])
  })
  it('ranks an exact plate first, then "ends with", then "starts with", then the rest', () => {
    const list = [v('AB 1234'), v('1234 AB'), v('X1234Y'), v('ZZ 1234')]
    expect(searchPlates(list, '1234').map((x) => x.plateNo)).toEqual(['AB 1234', 'ZZ 1234', '1234 AB', 'X1234Y'])
    expect(searchPlates([v('CAB 1234'), v('XCAB1234')], 'CAB1234').map((x) => x.plateNo)).toEqual(['CAB 1234', 'XCAB1234'])
  })
  it('needs 2 characters and returns at most 8 matches', () => {
    expect(plates('4')).toEqual([])
    expect(plates(' - ')).toEqual([])
    expect(plates('1234', 2)).toHaveLength(2)
    const many = Array.from({ length: 20 }, (_, i) => v(`AA ${1000 + i}`))
    expect(searchPlates(many, 'AA')).toHaveLength(8)
  })
})
