import { describe, expect, it } from 'vitest'
import { canCheckIn, canDeny, computeGateResult, gateTone, type GateInputs } from './gateResult'

const TODAY = '20260310'
const base: GateInputs = {
  vehicle: { status: 'active' },
  pass: { status: 'officer_approved', dateKey: TODAY },
  driver: { status: 'active' },
  contractor: { status: 'active' },
  today: TODAY,
}
const r = (over: Partial<GateInputs>) => computeGateResult({ ...base, ...over })

describe('computeGateResult', () => {
  it('approved: officer_approved today with everything active', () => {
    expect(r({})).toEqual({ kind: 'approved' })
    expect(canCheckIn(r({}))).toBe(true)
    expect(gateTone('approved')).toBe('green')
  })
  it('already checked in (server) or pending sync (this phone)', () => {
    expect(r({ pass: { status: 'checked_in', dateKey: TODAY } })).toEqual({ kind: 'already_checked_in', pendingSync: false })
    expect(r({ pendingSync: true })).toEqual({ kind: 'already_checked_in', pendingSync: true })
    expect(gateTone('already_checked_in')).toBe('amber')
  })
  it('every pass status maps to its result', () => {
    expect(r({ pass: { status: 'submitted', dateKey: TODAY } })).toEqual({ kind: 'pending_supervisor' })
    expect(r({ pass: { status: 'supervisor_approved', dateKey: TODAY } })).toEqual({ kind: 'pending_officer' })
    expect(r({ pass: { status: 'rejected', dateKey: TODAY, rejection: { reason: 'Photo looks old' } } })).toEqual({ kind: 'rejected', reason: 'Photo looks old' })
    expect(r({ pass: { status: 'rejected', dateKey: TODAY } })).toEqual({ kind: 'rejected', reason: null })
  })
  it('no pass today, including a pass of another day', () => {
    expect(r({ pass: null, driver: null })).toEqual({ kind: 'no_pass_today' })
    expect(r({ pass: { status: 'officer_approved', dateKey: '20260309' } })).toEqual({ kind: 'no_pass_today' })
  })
  it('not found beats everything', () => {
    expect(r({ vehicle: null })).toEqual({ kind: 'not_found' })
    expect(canDeny(r({ vehicle: null }))).toBe(false)
  })
  it('suspended vehicle, contractor or driver blocks even an approved pass', () => {
    expect(r({ vehicle: { status: 'suspended' } })).toEqual({ kind: 'vehicle_suspended' })
    expect(r({ contractor: { status: 'suspended' } })).toEqual({ kind: 'contractor_suspended' })
    expect(r({ driver: { status: 'disabled' } })).toEqual({ kind: 'driver_suspended' })
    for (const over of [{ vehicle: { status: 'suspended' as const } }, { contractor: { status: 'suspended' as const } }, { driver: { status: 'disabled' as const } }]) {
      expect(canCheckIn(r(over))).toBe(false)
      expect(gateTone(r(over).kind)).toBe('red')
      expect(canDeny(r(over))).toBe(true)
    }
  })
  it('priority: vehicle before contractor before driver, and a suspension beats "no pass" and pending', () => {
    expect(r({ vehicle: { status: 'suspended' }, contractor: { status: 'suspended' }, driver: { status: 'disabled' } }).kind).toBe('vehicle_suspended')
    expect(r({ contractor: { status: 'suspended' }, driver: { status: 'disabled' } }).kind).toBe('contractor_suspended')
    expect(r({ vehicle: { status: 'suspended' }, pass: null }).kind).toBe('vehicle_suspended')
    expect(r({ driver: { status: 'disabled' }, pass: { status: 'submitted', dateKey: TODAY } }).kind).toBe('driver_suspended')
  })
  it('already checked in beats a later suspension: the vehicle is inside', () => {
    expect(r({ pass: { status: 'checked_in', dateKey: TODAY }, vehicle: { status: 'suspended' } }).kind).toBe('already_checked_in')
  })
  it('an unknown driver or contractor (not readable, no profile) does not block on its own', () => {
    expect(r({ driver: null, contractor: null })).toEqual({ kind: 'approved' })
  })
  it('only the green state can check in; every non-approved state is red', () => {
    for (const kind of ['pending_supervisor', 'pending_officer', 'rejected', 'no_pass_today', 'vehicle_suspended', 'driver_suspended', 'contractor_suspended', 'not_found'] as const) {
      expect(gateTone(kind)).toBe('red')
    }
    expect(canCheckIn({ kind: 'already_checked_in', pendingSync: false })).toBe(false)
  })
})
