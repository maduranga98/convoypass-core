import { describe, expect, it } from 'vitest'
import { changePasswordUrl, loginUrl, nextForRole, safeNext } from './redirect'

describe('safeNext', () => {
  it('keeps same-origin paths, including query and hash', () => {
    expect(safeNext('/v/abc123')).toBe('/v/abc123')
    expect(safeNext('/v/abc?x=1#y')).toBe('/v/abc?x=1#y')
  })
  it.each([null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/login', '/login?next=/x', '/login/staff'])(
    'rejects %s',
    (v) => expect(safeNext(v)).toBeNull(),
  )
})

describe('urls', () => {
  it('encodes the target', () => {
    expect(loginUrl('/v/abc123?a=b')).toBe('/login?next=%2Fv%2Fabc123%3Fa%3Db')
    expect(loginUrl('/driver')).toBe('/login?next=%2Fdriver')
    expect(loginUrl('/security/queue')).toBe('/login?next=%2Fsecurity%2Fqueue')
    expect(changePasswordUrl('/driver')).toBe('/change-password?next=%2Fdriver')
  })
})

describe('loginUrl (Module 12)', () => {
  it('sends office-staff areas to the email form, everything else to the PIN screen', () => {
    expect(loginUrl('/admin/users')).toBe('/login/staff?next=%2Fadmin%2Fusers')
    expect(loginUrl('/officer?pass=x')).toBe('/login/staff?next=%2Fofficer%3Fpass%3Dx')
    expect(loginUrl('/supervisor')).toBe('/login/staff?next=%2Fsupervisor')
    expect(loginUrl('/settings')).toBe('/login?next=%2Fsettings')
    expect(loginUrl('/administrator')).toBe('/login?next=%2Fadministrator')
  })
})

describe('nextForRole', () => {
  it("drops another role's area left behind by a previous session", () => {
    expect(nextForRole('supervisor', '/admin/dashboard')).toBeNull()
    expect(nextForRole('supervisor', '/admin')).toBeNull()
    expect(nextForRole('admin', '/supervisor/approvals')).toBeNull()
    expect(nextForRole('driver', '/platform/invites')).toBeNull()
  })
  it("keeps the role's own area and shared paths", () => {
    expect(nextForRole('supervisor', '/supervisor/vehicles?new=1')).toBe('/supervisor/vehicles?new=1')
    expect(nextForRole('supervisor', '/v/veh_abc123defg')).toBe('/v/veh_abc123defg')
    expect(nextForRole('officer', '/notifications')).toBe('/notifications')
    expect(nextForRole('admin', '/administrator')).toBe('/administrator')
  })
  it('still rejects unsafe paths', () => expect(nextForRole('admin', '//evil.com')).toBeNull())
})
