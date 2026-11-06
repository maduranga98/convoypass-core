import { describe, expect, it } from 'vitest'
import { DEFAULT_CHECKLIST, type ChecklistItemDef } from '@/lib/defaultChecklist'
import { allOk, answersFromPrevious, checklistStatus, toPayload, type Answers } from './checklist'

const items: ChecklistItemDef[] = [
  { id: 'a', label: 'Item A', failBlocks: false },
  { id: 'b', label: 'Item B', failBlocks: true },
  { id: 'c', label: 'Item C', failBlocks: false },
]

describe('checklistStatus', () => {
  it('nothing is preselected', () => {
    expect(checklistStatus(items, {})).toMatchObject({ answered: 0, total: 3, complete: false })
  })
  it('is incomplete until every item is answered', () => {
    const a: Answers = { a: { answer: 'yes' }, b: { answer: 'yes' } }
    expect(checklistStatus(items, a)).toMatchObject({ answered: 2, complete: false })
    expect(checklistStatus(items, { ...a, c: { answer: 'yes' } })).toMatchObject({ answered: 3, complete: true })
  })
  it('a "no" needs a note of at least 3 characters', () => {
    const base: Answers = { a: { answer: 'yes' }, b: { answer: 'yes' } }
    expect(checklistStatus(items, { ...base, c: { answer: 'no' } }).complete).toBe(false)
    expect(checklistStatus(items, { ...base, c: { answer: 'no', note: ' ab ' } }).complete).toBe(false)
    expect(checklistStatus(items, { ...base, c: { answer: 'no', note: 'Lens dirty' } }).complete).toBe(true)
  })
  it('a failBlocks item answered no blocks, even with a note', () => {
    const a: Answers = { a: { answer: 'yes' }, b: { answer: 'no', note: 'Broken brakes' }, c: { answer: 'yes' } }
    const s = checklistStatus(items, a)
    expect(s.complete).toBe(false)
    expect(s.blocked.map((i) => i.id)).toEqual(['b'])
  })
})

describe('allOk', () => {
  it('sets every item to yes', () => {
    const a = allOk(DEFAULT_CHECKLIST)
    expect(Object.keys(a)).toHaveLength(DEFAULT_CHECKLIST.length)
    expect(Object.values(a).every((v) => v.answer === 'yes')).toBe(true)
    expect(checklistStatus(DEFAULT_CHECKLIST, a).complete).toBe(true)
  })
})

describe('answersFromPrevious', () => {
  it('prefills known items and ignores ones that were removed', () => {
    const a = answersFromPrevious(items, [
      { id: 'a', label: 'x', answer: 'no', note: 'Loose' },
      { id: 'gone', label: 'y', answer: 'yes' },
    ])
    expect(a).toEqual({ a: { answer: 'no', note: 'Loose' } })
  })
})

describe('toPayload', () => {
  it('trims notes and sends notes only with "no"', () => {
    const a: Answers = { a: { answer: 'no', note: '  Loose  ' }, b: { answer: 'yes', note: 'stale' }, c: { answer: 'yes' } }
    expect(toPayload(items, a)).toEqual([
      { id: 'a', answer: 'no', note: 'Loose' },
      { id: 'b', answer: 'yes' },
      { id: 'c', answer: 'yes' },
    ])
  })
})
