import { describe, expect, it } from 'vitest'
import { makePass, no, TODAY, YESTERDAY } from '@/test/passFactory'
import { isBulkSelectable, pruneSelection, selectableIds, toggleSelection } from './bulk'

const clean = makePass({ id: 'clean' })
const issue = makePass({ id: 'issue', checklist: [no('a')] })
const old = makePass({ id: 'old', dateKey: YESTERDAY })

const sel = (...pairs: [string, number][]) => new Map(pairs)

describe('bulk selection', () => {
  it('only passes with every answer Yes, from today, are selectable', () => {
    expect(isBulkSelectable(clean, TODAY)).toBe(true)
    expect(isBulkSelectable(issue, TODAY)).toBe(false)
    expect(isBulkSelectable(old, TODAY)).toBe(false)
  })
  it('toggling a pass with issues never selects it', () => {
    expect(toggleSelection(sel(), issue, TODAY).size).toBe(0)
    expect(toggleSelection(sel(), old, TODAY).size).toBe(0)
    const picked = toggleSelection(sel(), clean, TODAY)
    expect([...picked]).toEqual([['clean', 1]])
    expect(toggleSelection(picked, clean, TODAY).size).toBe(0)
  })
  it('"select all" leaves the issue passes out', () => {
    expect(selectableIds([clean, issue, old, makePass({ id: 'c2' })], TODAY)).toEqual(['clean', 'c2'])
  })
  it('drops ids that left the list or got issues in the meantime', () => {
    const picked = sel(['clean', 1], ['gone', 1], ['issue', 1])
    expect([...pruneSelection(picked, [clean, issue], TODAY).keys()]).toEqual(['clean'])
  })
  it('drops a pass the driver resubmitted after it was ticked (new attempt, new photos nobody has seen)', () => {
    const resubmitted = makePass({ id: 'clean', attempt: 2 })
    expect(pruneSelection(sel(['clean', 1]), [resubmitted], TODAY).size).toBe(0)
    expect([...pruneSelection(sel(['clean', 2]), [resubmitted], TODAY)]).toEqual([['clean', 2]])
  })
})
