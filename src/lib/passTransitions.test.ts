import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/passTransitions'
import { DEFAULT_REJECTION_REASONS as fnReasons } from '../../functions/src/defaultRejectionReasons'
import { DEFAULT_REJECTION_REASONS } from './defaultRejectionReasons'
import * as fnDeny from '../../functions/src/denyReasons'
import * as fnGates from '../../functions/src/gates'
import * as fnSla from '../../functions/src/defaultSla'
import * as webSla from './defaultSla'
import * as webDeny from './denyReasons'
import * as webGates from './gates'
import * as web from './passTransitions'
import type { Role } from './roles'
import type { PassStatus } from '@/types/passes'

describe('passTransitions mirror', () => {
  it('has the same transition table as the functions copy', () => {
    expect(web.TRANSITIONS).toEqual(fn.TRANSITIONS)
  })
  it('agrees on stages and on every (role, status, action, stage) combination', () => {
    const roles: Role[] = ['admin', 'officer', 'supervisor', 'driver', 'security']
    const statuses: PassStatus[] = ['submitted', 'supervisor_approved', 'officer_approved', 'checked_in', 'rejected']
    for (const role of roles) {
      expect(web.reviewStageOf(role)).toBe(fn.reviewStageOf(role))
      for (const stage of ['supervisor', 'officer'] as const) expect(web.statusForStage(stage)).toBe(fn.statusForStage(stage))
      for (const status of statuses) {
        for (const action of ['approve', 'reject', 'revoke', 'check_in'] as const) {
          for (const stage of ['supervisor', 'officer', 'revoked', 'gate'] as const) {
            expect(web.canTransition(role, status, action, stage)).toBe(fn.canTransition(role, status, action, stage))
          }
        }
      }
    }
  })
  it('never lets admin approve or reject', () => {
    expect(web.reviewStageOf('admin')).toBeNull()
    expect(web.canTransition('admin', 'officer_approved', 'revoke', 'revoked')).toBe(true)
    expect(web.canTransition('admin', 'supervisor_approved', 'approve', 'officer')).toBe(false)
  })
  it('keeps the default rejection reasons in sync, ending with "other"', () => {
    expect(DEFAULT_REJECTION_REASONS).toEqual(fnReasons)
    expect(DEFAULT_REJECTION_REASONS.at(-1)?.id).toBe('other')
  })
  it('only security can check in, and only an officer_approved pass', () => {
    expect(web.canTransition('security', 'officer_approved', 'check_in', 'gate')).toBe(true)
    for (const role of ['admin', 'officer', 'supervisor', 'driver'] as const) {
      expect(web.canTransition(role, 'officer_approved', 'check_in', 'gate')).toBe(false)
    }
    expect(web.canTransition('security', 'supervisor_approved', 'check_in', 'gate')).toBe(false)
  })
  it('keeps the deny reasons and the gate defaults in sync with the functions copies', () => {
    expect(webDeny.DENY_REASONS).toEqual(fnDeny.DENY_REASONS)
    expect(webDeny.DENY_OTHER_ID).toBe(fnDeny.DENY_OTHER_ID)
    expect([webDeny.MIN_DENY_NOTE, webDeny.MAX_DENY_NOTE]).toEqual([fnDeny.MIN_DENY_NOTE, fnDeny.MAX_DENY_NOTE])
    expect(webGates.DEFAULT_GATES).toEqual(fnGates.DEFAULT_GATES)
    expect(String(webGates.GATE_ID_PATTERN)).toBe(String(fnGates.GATE_ID_PATTERN))
    expect([webGates.MIN_GATES, webGates.MAX_GATES, webGates.GATE_NAME_MIN, webGates.GATE_NAME_MAX]).toEqual([
      fnGates.MIN_GATES, fnGates.MAX_GATES, fnGates.GATE_NAME_MIN, fnGates.GATE_NAME_MAX,
    ])
    expect(webGates.gatesOf({ gates: [] })).toEqual(webGates.DEFAULT_GATES)
    expect(webGates.gatesOf({ gates: [{ id: 'north', name: 'North' }] })).toEqual([{ id: 'north', name: 'North' }])
  })
  it('keeps the SLA defaults and limits in sync with the functions copy', () => {
    expect(webSla.DEFAULT_SLA).toEqual(fnSla.DEFAULT_SLA)
    expect([webSla.SLA_MIN, webSla.SLA_MAX]).toEqual([fnSla.SLA_MIN, fnSla.SLA_MAX])
    expect(webSla.slaOf({ sla: { officerMinutes: 60 } })).toEqual({ supervisorMinutes: 30, officerMinutes: 60 })
  })
})
