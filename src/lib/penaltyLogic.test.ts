import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/penaltyLogic'
import * as web from './penaltyLogic'

describe('penalty logic', () => {
  it('exports the same constants and behaves identically in the web and functions copies', () => {
    const constants = ['PENALTY_STATUSES', 'PENALTY_TYPE_NAME_MIN', 'PENALTY_TYPE_NAME_MAX', 'MAX_PENALTY_TYPES', 'PENALTY_REASON_MIN', 'PENALTY_REASON_MAX', 'PENALTY_NOTE_MAX', 'PENALTY_MAX_DAYS'] as const
    for (const k of constants) expect(web[k]).toEqual(fn[k])
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())

    const target = { driverId: 'd', vehicleId: 'v' }
    const cases = [
      { status: 'active', duration: { kind: 'permanent' } },
      { status: 'active', duration: { kind: 'fixed', endDate: 1000 } },
      { status: 'expired', duration: { kind: 'fixed', endDate: 1000 } },
      { status: 'revoked', duration: { kind: 'permanent' } },
    ] as const
    for (const c of cases) {
      for (const now of [0, 1000, 1001]) {
        expect(web.isBlocking(c, now)).toBe(fn.isBlocking(c, now))
        expect(web.shouldExpire(c, now)).toBe(fn.shouldExpire(c, now))
        expect(web.effectiveStatus(c, now)).toBe(fn.effectiveStatus(c, now))
        expect(web.blockingPenalties([{ ...c, target }], { driverId: 'd' }, now)).toEqual(fn.blockingPenalties([{ ...c, target }], { driverId: 'd' }, now))
      }
    }
    for (const blocked of [true, false]) {
      for (const docs of [['valid'], ['expiringSoon', 'valid'], ['expired'], []] as const) {
        expect(web.combineStatus(blocked, docs)).toBe(fn.combineStatus(blocked, docs))
      }
    }
    expect(web.endOfDayMs('Asia/Colombo', '2026-03-01')).toBe(fn.endOfDayMs('Asia/Colombo', '2026-03-01'))
  })

  it('shows a stored-active penalty past its end as expired', () => {
    expect(web.effectiveStatus({ status: 'active', duration: { kind: 'fixed', endDate: 5 } }, 6)).toBe('expired')
    expect(web.effectiveStatus({ status: 'active', duration: { kind: 'fixed', endDate: 5 } }, 5)).toBe('active')
    expect(web.effectiveStatus({ status: 'revoked', duration: { kind: 'fixed', endDate: 5 } }, 6)).toBe('revoked')
  })
})
