import { afterEach, describe, expect, it } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from './draft'

// Vitest "unit" runs in node: give it a minimal sessionStorage.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})
afterEach(() => store.clear())

describe('checklist draft', () => {
  it('round-trips per vehicle and day', () => {
    saveDraft('veh_a', '20260310', { x: { answer: 'no', note: 'Loose' } })
    expect(loadDraft('veh_a', '20260310')).toEqual({ x: { answer: 'no', note: 'Loose' } })
    expect(loadDraft('veh_a', '20260311')).toBeNull()
    expect(loadDraft('veh_b', '20260310')).toBeNull()
  })
  it('clears', () => {
    saveDraft('veh_a', '20260310', { x: { answer: 'yes' } })
    clearDraft('veh_a', '20260310')
    expect(loadDraft('veh_a', '20260310')).toBeNull()
  })
  it('ignores corrupt data', () => {
    store.set('cp:pretrip:veh_a:20260310', '{nope')
    expect(loadDraft('veh_a', '20260310')).toBeNull()
    store.set('cp:pretrip:veh_a:20260310', JSON.stringify({ x: { answer: 'maybe', note: 5 }, y: 'z' }))
    expect(loadDraft('veh_a', '20260310')).toEqual({ x: {} })
  })
})
