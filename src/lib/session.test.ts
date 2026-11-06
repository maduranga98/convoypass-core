import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/session'
import { formatPin, pinDigits } from './pin'
import * as web from './session'

describe('session limits mirror (Module 12)', () => {
  it('has the same PIN roles and limits as the functions copy', () => {
    expect(web.PIN_ROLES).toEqual(fn.PIN_ROLES)
    expect(web.SESSION_MAX_AGE_SECONDS).toEqual(fn.SESSION_MAX_AGE_SECONDS)
  })
  it('the Yard Officer signs in with a PIN like security, with the same 16-hour session', () => {
    expect(web.PIN_ROLES).toContain('yard')
    expect(web.isPinRole('yard')).toBe(true)
    expect(web.SESSION_MAX_AGE_SECONDS.yard).toBe(16 * 3600)
    expect(web.sessionExpired('yard', 0, 16 * 3600 + 1)).toBe(true)
    expect(web.sessionExpired('yard', 0, 16 * 3600)).toBe(false)
    expect(web.isPinRole('safety')).toBe(false)
  })
  it('agrees on expiry for every role around each limit', () => {
    const now = 2_000_000_000
    for (const role of ['admin', 'officer', 'supervisor', 'safety', 'driver', 'security', 'yard'] as const) {
      for (const age of [0, 16 * 3600, 16 * 3600 + 1, 90 * 86400, 90 * 86400 + 1]) {
        expect(web.sessionExpired(role, now - age, now)).toBe(fn.sessionExpired(role, now - age, now))
      }
    }
  })
})

describe('pin helpers', () => {
  it('keeps digits only, at most 8, and formats 4 + 4', () => {
    expect(pinDigits(' 4829 1736 ')).toBe('48291736')
    expect(pinDigits('4829-17369')).toBe('48291736')
    expect(formatPin('48291736')).toBe('4829 1736')
    expect(formatPin('482')).toBe('482')
  })
})
