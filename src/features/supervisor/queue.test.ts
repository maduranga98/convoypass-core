import { describe, expect, it } from 'vitest'
import { makePass, ts } from '@/test/passFactory'
import { isOverdue, nextInQueue, oldestFirst } from './queue'

const NOW = 1_000_000_000_000
const sent = (id: string, minsAgo: number | null) => makePass({ id, submittedAt: minsAgo === null ? null : ts(NOW - minsAgo * 60_000) } as never)

describe('supervisor queue', () => {
  it('sorts longest waiting first, a pending server time last', () => {
    expect(oldestFirst([sent('a', 5), sent('b', null), sent('c', 40), sent('d', 12)]).map((p) => p.id)).toEqual(['c', 'd', 'a', 'b'])
  })
  it('is overdue only once the target has passed', () => {
    expect(isOverdue(sent('a', 30), NOW, 30)).toBe(false)
    expect(isOverdue(sent('a', 31), NOW, 30)).toBe(true)
    expect(isOverdue(sent('a', null), NOW, 30)).toBe(false)
  })
  it('moves to the pass after the current one, wrapping round', () => {
    expect(nextInQueue(['a', 'b', 'c'], 'a')).toBe('b')
    expect(nextInQueue(['a', 'b', 'c'], 'c')).toBe('a')
    expect(nextInQueue(['a', 'b'], 'x')).toBe('a')
    expect(nextInQueue(['a'], 'a')).toBeNull()
    expect(nextInQueue([], 'a')).toBeNull()
  })
})
