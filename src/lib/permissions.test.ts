import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/permissions'
import { ROLE_HOME, ROLES } from './roles'
import * as web from './permissions'

describe('permissions matrix', () => {
  it('is identical in the web and functions copies', () => {
    expect(web.PERMISSIONS).toEqual(fn.PERMISSIONS)
  })

  it('has an area for every role, and only that role may open it', () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toBe(`/${role}`)
      expect(web.rolesFor(`area.${role}` as web.Action)).toEqual([role])
    }
  })

  it('lets only the Super admin create admins and workspaces', () => {
    expect(web.rolesFor('user.create.admin')).toEqual([])
    expect(web.can('superadmin', 'user.create.admin')).toBe(true)
    expect(web.can('admin', 'user.create.admin')).toBe(false)
    expect(web.can('superadmin', 'workspace.create')).toBe(true)
    expect(web.can('admin', 'workspace.create')).toBe(false)
  })

  it('lets admins create every non-admin role and supervisors only drivers', () => {
    for (const target of ROLES.filter((r) => r !== 'admin')) {
      expect(web.canCreateRole('admin', target)).toBe(true)
      expect(web.canCreateRole('supervisor', target)).toBe(target === 'driver')
      for (const caller of ['officer', 'safety', 'security', 'driver'] as const) {
        expect(web.canCreateRole(caller, target)).toBe(false)
      }
    }
    expect(web.canCreateRole('admin', 'admin')).toBe(false)
  })

  it('gives penalties to the right roles: admin and Safety Officer issue, only admin revokes, only supervisors verify', () => {
    expect(web.rolesFor('penalty.issue').sort()).toEqual(['admin', 'safety'])
    expect(web.rolesFor('penalty.revoke')).toEqual(['admin'])
    expect(web.rolesFor('penalty.verify')).toEqual(['supervisor'])
    expect(web.rolesFor('penaltyType.manage')).toEqual(['admin'])
    expect(web.rolesFor('penalty.view').sort()).toEqual(['admin', 'safety', 'supervisor'])
    expect(web.rolesFor('penaltyType.view').sort()).toEqual(['admin', 'safety', 'supervisor'])
    // Security and drivers never open the penalty screens; security only consumes the eligibility check.
    for (const role of ['security', 'driver', 'officer'] as const) {
      for (const action of ['penalty.view', 'penalty.issue', 'penalty.revoke', 'penalty.verify', 'penaltyType.manage'] as const) {
        expect(web.can(role, action)).toBe(false)
      }
    }
    expect(web.can('security', 'eligibility.check')).toBe(true)
    expect(web.can('driver', 'eligibility.check')).toBe(false)
    expect(web.can('superadmin', 'penalty.issue')).toBe(false)
  })

  it('denies unknown principals', () => {
    expect(web.can(null, 'account.view')).toBe(false)
    expect(web.can(undefined, 'account.view')).toBe(false)
  })

  it('lets admins and supervisors manage vehicles, the Safety Officer only read them', () => {
    expect(web.rolesFor('vehicle.manage')).toEqual(['admin', 'supervisor'])
    expect(web.rolesFor('vehicle.view')).toContain('safety')
    expect(web.can('safety', 'vehicle.manage')).toBe(false)
    for (const role of ['security', 'driver'] as const) expect(web.can(role, 'vehicle.manage')).toBe(false)
    expect(web.rolesFor('driver.view')).not.toContain('driver')
    expect(web.rolesFor('vehicle.setStatus')).toEqual(['admin'])
    expect(web.rolesFor('vehicleType.manage')).toEqual(['admin'])
    expect(web.rolesFor('expiry.settings')).toEqual(['admin'])
  })

  it('visit lifecycle: security writes the gate stages, the Yard Officer the unloading check, everyone else reads', () => {
    expect(web.rolesFor('visit.checkIn')).toEqual(['security'])
    expect(web.rolesFor('visit.checkOut')).toEqual(['security'])
    expect(web.rolesFor('visit.unloadingCheck')).toEqual(['yard'])
    expect(web.rolesFor('visit.view')).toEqual(['admin', 'officer', 'supervisor', 'safety', 'security', 'yard'])
    expect(web.rolesFor('visit.summary')).toEqual(web.rolesFor('visit.view'))
    for (const role of ['admin', 'officer', 'supervisor', 'safety', 'driver'] as const) {
      for (const action of ['visit.checkIn', 'visit.checkOut', 'visit.unloadingCheck'] as const) expect(web.can(role, action)).toBe(false)
    }
    expect(web.can('driver', 'visit.view')).toBe(false)
    expect(web.can('superadmin', 'visit.view')).toBe(false)
  })

  it('the Yard Officer is created by the admin only and has no access to penalties, inspections or admin screens', () => {
    expect(web.rolesFor('user.create.yard')).toEqual(['admin'])
    expect(web.canCreateRole('admin', 'yard')).toBe(true)
    expect(web.canCreateRole('supervisor', 'yard')).toBe(false)
    expect(web.rolesFor('area.yard')).toEqual(['yard'])
    for (const action of ['penalty.view', 'penalty.issue', 'inspection.view', 'inspection.record', 'vehicle.view', 'driver.view', 'eligibility.check', 'settings.manage', 'audit.view', 'area.admin'] as const) {
      expect(web.can('yard', action)).toBe(false)
    }
    expect(web.can('yard', 'account.view')).toBe(true)
    expect(web.can('yard', 'account.password.change')).toBe(false) // PIN users have no password
  })
})
