import { describe, expect, it } from 'vitest'
import { formatPlateInput, normalisePlate } from './plate'

describe('normalisePlate', () => {
  it.each([
    ['WP LJ-4821', 'WP LJ-4821', 'WPLJ4821'],
    ['NP KA 1234', 'NP KA 1234', 'NPKA1234'],
    ['CAB-1234', 'CAB-1234', 'CAB1234'],
    ['250-1234', '250-1234', '2501234'],
  ])('keeps the example plate %s usable', (input, plateNo, plateKey) => {
    expect(normalisePlate(input)).toEqual({ plateNo, plateKey })
  })

  it('normalises case, spacing and stray characters', () => {
    expect(normalisePlate('  wp   lj - 4821 ')).toEqual({ plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821' })
    expect(normalisePlate('wp/lj.4821!')).toEqual({ plateNo: 'WPLJ4821', plateKey: 'WPLJ4821' })
    expect(normalisePlate('--CAB--1234--')?.plateNo).toBe('CAB-1234')
  })

  it('gives the same key for any spacing or case', () => {
    const keys = ['WP LJ-4821', 'wplj4821', 'Wp-Lj 4821', 'WP  LJ  4821'].map((p) => normalisePlate(p)?.plateKey)
    expect(new Set(keys)).toEqual(new Set(['WPLJ4821']))
  })

  it('enforces 4-12 alphanumerics', () => {
    expect(normalisePlate('AB-1')).toBeNull()
    expect(normalisePlate('A B 3')).toBeNull()
    expect(normalisePlate('---')).toBeNull()
    expect(normalisePlate('ABCD')).not.toBeNull()
    expect(normalisePlate('ABCDEFGHIJKL')).not.toBeNull()
    expect(normalisePlate('ABCDEFGHIJKLM')).toBeNull()
  })
})

describe('formatPlateInput', () => {
  it('uppercases and strips invalid characters but keeps a trailing space for typing', () => {
    expect(formatPlateInput('wp ')).toBe('WP ')
    expect(formatPlateInput('wp  lj_-48#21')).toBe('WP LJ-4821')
  })
})
