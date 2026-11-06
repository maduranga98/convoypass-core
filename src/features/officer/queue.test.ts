import { describe, expect, it } from 'vitest'
import { makePass, ts } from '@/test/passFactory'
import { isOfficerOverdue, oldestWaitingFirst, waitingSince } from './queue'

const NOW = 1_000_000_000_000
const at = (mins: number) => ts(NOW - mins * 60_000)
/** Submitted `sentMins` ago, approved by the supervisor `approvedMins` ago (null = not yet stamped). */
const pass = (id: string, sentMins: number, approvedMins: number | null) =>
  makePass({ id, submittedAt: at(sentMins), supervisor: approvedMins === null ? null : { uid: 's', name: 'Sue', at: at(approvedMins) } } as never)

describe('officer queue', () => {
  it('measures the wait from the supervisor approval, else from submission', () => {
    expect(waitingSince(pass('a', 50, 10))).toBe(NOW - 10 * 60_000)
    expect(waitingSince(pass('a', 50, null))).toBe(NOW - 50 * 60_000)
  })
  it('sorts longest waiting for the officer first', () => {
    // b was sent first but reached the officer last.
    expect(oldestWaitingFirst([pass('a', 20, 15), pass('b', 90, 2), pass('c', 40, 35)]).map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
  it('is overdue only once the officer target has passed since the supervisor approved', () => {
    expect(isOfficerOverdue(pass('a', 120, 30), NOW, 30)).toBe(false)
    expect(isOfficerOverdue(pass('a', 120, 31), NOW, 30)).toBe(true)
  })
})
