import { describe, expect, it } from 'vitest'
import { blockingPenalties, combineStatus, endOfDayMs, isBlocking, shouldExpire, targetsRecord } from './penaltyLogic.js'

const fixed = (endDate: number) => ({ status: 'active' as const, duration: { kind: 'fixed' as const, endDate } })

describe('isBlocking / shouldExpire', () => {
  it('permanent active blocks forever; fixed blocks through its end instant', () => {
    expect(isBlocking({ status: 'active', duration: { kind: 'permanent' } }, 9e15)).toBe(true)
    expect(isBlocking(fixed(100), 100)).toBe(true)
    expect(isBlocking(fixed(100), 101)).toBe(false)
  })
  it('expired and revoked never block', () => {
    expect(isBlocking({ status: 'expired', duration: { kind: 'permanent' } }, 0)).toBe(false)
    expect(isBlocking({ status: 'revoked', duration: { kind: 'permanent' } }, 0)).toBe(false)
  })
  it('only an active fixed penalty past its end should be expired', () => {
    expect(shouldExpire(fixed(100), 101)).toBe(true)
    expect(shouldExpire(fixed(100), 100)).toBe(false)
    expect(shouldExpire({ status: 'active', duration: { kind: 'permanent' } }, 1e15)).toBe(false)
    expect(shouldExpire({ status: 'revoked', duration: { kind: 'fixed', endDate: 1 } }, 100)).toBe(false)
  })
})

describe('targets and combining', () => {
  const p = { status: 'active' as const, duration: { kind: 'permanent' as const }, target: { driverId: 'd1', vehicleId: 'v1' } }
  it('matches a penalty on either side of "both"', () => {
    expect(targetsRecord(p.target, { vehicleId: 'v1' })).toBe(true)
    expect(targetsRecord(p.target, { driverId: 'd1' })).toBe(true)
    expect(targetsRecord(p.target, { vehicleId: 'v2', driverId: 'd2' })).toBe(false)
    expect(targetsRecord(p.target, {})).toBe(false)
    expect(targetsRecord({ driverId: null, vehicleId: null }, { vehicleId: null })).toBe(false)
  })
  it('filters to the blocking ones that apply', () => {
    const ended = { ...p, status: 'expired' as const }
    expect(blockingPenalties([p, ended], { driverId: 'd1' }, 0)).toEqual([p])
  })
  it('blocked beats everything; otherwise the worst document status wins', () => {
    expect(combineStatus(true, ['valid'])).toBe('blocked')
    expect(combineStatus(true, ['expired'])).toBe('blocked')
    expect(combineStatus(false, ['valid', 'expiringSoon'])).toBe('expiringSoon')
    expect(combineStatus(false, ['expiringSoon', 'expired'])).toBe('expired')
    expect(combineStatus(false, [undefined, null])).toBe('valid')
  })
})

describe('endOfDayMs', () => {
  it('is the last millisecond of that day in the zone', () => {
    expect(endOfDayMs('Asia/Colombo', '2023-11-15')).toBe(Date.UTC(2023, 10, 15, 18, 29, 59, 999))
    expect(endOfDayMs('UTC', '2023-11-15')).toBe(Date.UTC(2023, 10, 15, 23, 59, 59, 999))
    expect(endOfDayMs('America/New_York', '2023-11-15')).toBe(Date.UTC(2023, 10, 16, 4, 59, 59, 999))
  })
  it('handles daylight saving changes and month/year ends', () => {
    // New York leaves DST on 2023-11-05 (UTC-4 -> UTC-5): the end of that day is at 05:00 UTC the next day.
    expect(endOfDayMs('America/New_York', '2023-11-05')).toBe(Date.UTC(2023, 10, 6, 4, 59, 59, 999))
    expect(endOfDayMs('UTC', '2023-12-31')).toBe(Date.UTC(2023, 11, 31, 23, 59, 59, 999))
    expect(endOfDayMs('UTC', '2024-02-29')).toBe(Date.UTC(2024, 1, 29, 23, 59, 59, 999))
  })
})
