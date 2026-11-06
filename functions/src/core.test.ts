import { beforeEach, describe, expect, it } from 'vitest'
import { changeOwnPassword, createUser, reissuePin, resetCredential, revealPin, updateUser } from './core.js'
import { isTrivialPin, openPin, pinKey, sealPin } from './pin.js'
import { admin, caller, makeWorld, NOW, rejects, sup1, TEST_PEPPER, userDoc, type World } from './test-utils.js'

const staffInput = { role: 'officer', name: 'Off', email: 'new@x.com', password: 'longenough1' }
const driverInput = { role: 'driver', name: 'Drv', phone: '0779998888', contractorId: 'C1' }
const securityInput = { role: 'security', name: 'Guard' }

let w: World
beforeEach(() => {
  w = makeWorld()
})

describe('createUser: permission matrix', () => {
  it('admin can create an officer (email + password, unchanged)', async () => {
    const { uid, pin } = await createUser(w.deps, admin(), staffInput)
    expect(pin).toBeUndefined()
    expect(w.users.get(uid)).toMatchObject({ role: 'officer', tenantId: 'T1', contractorId: null, mustChangePassword: true, status: 'active', loginType: 'password' })
    expect(w.claims.get(uid)).toEqual({ role: 'officer', tenantId: 'T1' })
    expect(w.authUsers.get(uid)).toMatchObject({ email: 'new@x.com', password: 'longenough1' })
  })

  it('admin can create a security user: a PIN once, an Auth user with no email and no password', async () => {
    const { uid, pin } = await createUser(w.deps, admin(), securityInput)
    expect(pin).toMatch(/^\d{8}$/)
    expect(isTrivialPin(pin as string)).toBe(false)
    expect(w.authUsers.get(uid)).toEqual({ disabled: false, displayName: 'Guard' })
    expect(w.claims.get(uid)).toEqual({ role: 'security', tenantId: 'T1' })
    expect(w.users.get(uid)).toMatchObject({ role: 'security', email: null, phone: null, mustChangePassword: false, loginType: 'pin' })
    expect(w.pins.get(pinKey(pin as string, TEST_PEPPER))).toEqual({ uid, tenantId: 'T1', role: 'security' })
  })

  it('a tenant admin can no longer create an admin (the platform super admin does)', async () => {
    await rejects(createUser(w.deps, admin(), { ...staffInput, role: 'admin' }), 'permission-denied', 'forbidden')
    expect(w.authUsers.size).toBe(0)
    expect(w.users.has('new1')).toBe(false)
  })

  it('admin can create a safety officer: email + password, tenant-wide (no contractor)', async () => {
    const { uid, pin } = await createUser(w.deps, admin(), { ...staffInput, role: 'safety' })
    expect(pin).toBeUndefined()
    expect(w.claims.get(uid)).toEqual({ role: 'safety', tenantId: 'T1' })
    expect(w.users.get(uid)).toMatchObject({ role: 'safety', contractorId: null, loginType: 'password', mustChangePassword: true })
    await rejects(createUser(w.deps, admin(), { ...staffInput, role: 'safety', contractorId: 'C1' }), 'invalid-argument', 'invalid-input')
  })

  it('a safety officer cannot create anyone', async () => {
    await rejects(createUser(w.deps, caller('safe1', 'safety'), { ...driverInput }), 'permission-denied', 'forbidden')
  })

  it('admin can create a supervisor for an active contractor', async () => {
    const { uid } = await createUser(w.deps, admin(), { ...staffInput, role: 'supervisor', contractorId: 'C2' })
    expect(w.claims.get(uid)).toEqual({ role: 'supervisor', tenantId: 'T1', contractorId: 'C2' })
    expect(w.users.get(uid)?.contractorId).toBe('C2')
  })

  it('admin can create a driver: PIN once, no credentials on the Auth user, phone is contact info only', async () => {
    const { uid, pin } = await createUser(w.deps, admin(), driverInput)
    expect(pin).toMatch(/^\d{8}$/)
    expect(w.users.get(uid)).toMatchObject({ phone: '94779998888', email: null, contractorId: 'C1', loginType: 'pin', mustChangePassword: false })
    expect(w.authUsers.get(uid)).toEqual({ disabled: false, displayName: 'Drv' })
    expect(w.claims.get(uid)).toEqual({ role: 'driver', tenantId: 'T1', contractorId: 'C1' })
    expect(w.audits.at(-1)).toMatchObject({ action: 'user.create', actorUid: 'admin', targetId: uid, tenantId: 'T1' })
  })

  it('the PIN appears nowhere in Firestore or the audit log; only its HMAC is a pinIndex id', async () => {
    const { pin } = await createUser(w.deps, admin(), driverInput)
    const sec = await createUser(w.deps, admin(), securityInput)
    for (const p of [pin, sec.pin] as string[]) {
      const stored = JSON.stringify([[...w.users], [...w.drivers], w.audits, [...w.pins], [...w.authUsers], [...w.claims]])
      expect(stored).not.toContain(p)
      expect(w.pins.has(pinKey(p, TEST_PEPPER))).toBe(true)
    }
    expect([...w.pins.keys()].every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true)
  })

  it('a phone number is optional and need not be unique', async () => {
    const a = await createUser(w.deps, admin(), driverInput)
    const b = await createUser(w.deps, admin(), driverInput)
    expect(w.users.get(a.uid)?.phone).toBe(w.users.get(b.uid)?.phone)
    const c = await createUser(w.deps, admin(), { ...driverInput, phone: undefined })
    expect(w.users.get(c.uid)?.phone).toBeNull()
    expect(w.drivers.get(c.uid)?.phone).toBeNull()
  })

  it('PIN roles refuse a password or an email in the request', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, password: '12345678' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...securityInput, email: 'g@x.com' }), 'invalid-argument')
    expect(w.authUsers.size).toBe(0)
  })

  it('a PIN collision is retried with a new PIN (uniqueness across tenants)', async () => {
    w.pins.set(pinKey('48291736', TEST_PEPPER), { uid: 'someone', tenantId: 'T2', role: 'driver' })
    w.pinQueue = ['48291736', '48291736', '59302847']
    const { uid, pin } = await createUser(w.deps, admin(), driverInput)
    expect(pin).toBe('59302847')
    expect(w.pins.get(pinKey('48291736', TEST_PEPPER))?.uid).toBe('someone')
    expect(w.pins.get(pinKey('59302847', TEST_PEPPER))?.uid).toBe(uid)
  })

  it('concurrent creations never hand out the same PIN', async () => {
    w.pinQueue = ['48291736', '48291736', '59302847', '70413958']
    const [a, b] = await Promise.all([createUser(w.deps, admin(), driverInput), createUser(w.deps, admin(), securityInput)])
    expect(a.pin).not.toBe(b.pin)
    expect(w.pins.size).toBe(2)
  })

  it('without the PIN_PEPPER secret nothing is created', async () => {
    w.pepper = undefined
    await rejects(createUser(w.deps, admin(), driverInput), 'failed-precondition', 'config-missing')
    w.pepper = 'too-short'
    await rejects(createUser(w.deps, admin(), securityInput), 'failed-precondition', 'config-missing')
    expect(w.authUsers.size).toBe(0)
    expect(w.pins.size).toBe(0)
  })

  it('supervisor cannot create staff of any role', async () => {
    for (const role of ['admin', 'officer', 'security', 'supervisor'] as const) {
      await rejects(createUser(w.deps, sup1(), { ...staffInput, role, contractorId: 'C1' }), 'permission-denied', 'forbidden')
    }
    expect(w.authUsers.size).toBe(0)
  })

  it('supervisor creates drivers with contractorId forced to their own', async () => {
    const { uid } = await createUser(w.deps, sup1(), { ...driverInput, contractorId: 'C2' })
    expect(w.users.get(uid)?.contractorId).toBe('C1')
    expect(w.claims.get(uid)?.contractorId).toBe('C1')
  })

  it.each([
    ['officer', caller('officer', 'officer')],
    ['security', caller('sec', 'security')],
    ['driver', caller('drv1', 'driver', 'C1')],
  ])('%s cannot create anyone', async (_n, c) => {
    w.users.set('sec', userDoc({ role: 'security', contractorId: null }))
    await rejects(createUser(w.deps, c, driverInput), 'permission-denied', 'forbidden')
  })
})

describe('createUser: tenant and validation', () => {
  it('rejects a contractor from another tenant', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'CX' }), 'permission-denied', 'tenant-mismatch')
  })
  it('rejects a suspended or missing contractor', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'CS' }), 'failed-precondition', 'contractor-invalid')
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'nope' }), 'failed-precondition', 'contractor-invalid')
  })
  it('requires a contractor for supervisors and drivers, forbids it for other roles', async () => {
    await rejects(createUser(w.deps, admin(), { ...staffInput, role: 'supervisor' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: undefined }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...staffInput, contractorId: 'C1' }), 'invalid-argument')
  })
  it('validates password and phone by role', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, phone: '0112345678' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...staffInput, password: 'short' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...staffInput, password: undefined }), 'invalid-argument')
  })
  it('rejects malformed input', async () => {
    await rejects(createUser(w.deps, admin(), { role: 'god' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), null), 'invalid-argument')
  })
  it('rejects duplicate staff emails with a typed reason', async () => {
    await createUser(w.deps, admin(), staffInput)
    await rejects(createUser(w.deps, admin(), staffInput), 'already-exists', 'email-exists')
  })
  it('rejects callers whose users doc is missing, disabled, or contradicts the token', async () => {
    await rejects(createUser(w.deps, caller('ghost', 'admin'), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'admin', contractorId: null, status: 'disabled' }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'officer', contractorId: null }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'admin', contractorId: null, tenantId: 'T2' }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
  })
  it('compensates by deleting the Auth user when the Firestore write fails', async () => {
    w.failFirestoreCreate = true
    await rejects(createUser(w.deps, admin(), staffInput), 'internal')
    await rejects(createUser(w.deps, admin(), driverInput), 'internal')
    expect(w.authUsers.size).toBe(0)
    expect(w.pins.size).toBe(0)
  })
})

describe('updateUser', () => {
  it('a tenant admin cannot update any admin account, themselves included', async () => {
    w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
    for (const uid of ['admin', 'admin2']) {
      await rejects(updateUser(w.deps, admin(), { uid, status: 'disabled' }), 'permission-denied', 'forbidden')
      await rejects(updateUser(w.deps, admin(), { uid, name: 'New Name' }), 'permission-denied', 'forbidden')
    }
    expect(w.users.get('admin2')?.status).toBe('active')
    expect(w.users.get('admin')?.name).not.toBe('New Name')
    expect(w.revoked).toHaveLength(0)
  })
  it('a tenant admin still manages every other role', async () => {
    await updateUser(w.deps, admin(), { uid: 'officer', name: 'Olga 2' })
    expect(w.users.get('officer')?.name).toBe('Olga 2')
  })
  it('admin can disable a user: Auth disabled, tokens revoked, audit written', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    expect(w.users.get('drv1')?.status).toBe('disabled')
    expect(w.authUsers.get('drv1')?.disabled).toBe(true)
    expect(w.revoked).toContain('drv1')
    expect(w.audits.at(-1)?.action).toBe('user.disable')
  })
  it('re-enabling reverses it', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'active' })
    expect(w.authUsers.get('drv1')?.disabled).toBe(false)
    expect(w.users.get('drv1')?.status).toBe('active')
    expect(w.audits.at(-1)?.action).toBe('user.enable')
  })
  it('rejects users in another tenant', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'foreign', name: 'x' }), 'permission-denied', 'tenant-mismatch')
  })
  it('404s for unknown users', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'nope', name: 'x' }), 'not-found')
  })
  it('supervisor manages drivers of own contractor only', async () => {
    await updateUser(w.deps, sup1(), { uid: 'drv1', name: 'Renamed' })
    expect(w.users.get('drv1')?.name).toBe('Renamed')
    await rejects(updateUser(w.deps, sup1(), { uid: 'drv2', name: 'x' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'officer', name: 'x' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'admin', status: 'disabled' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'sup1', name: 'x' }), 'permission-denied', 'forbidden')
  })
  it.each([
    ['officer', caller('officer', 'officer')],
    ['driver', caller('drv1', 'driver', 'C1')],
  ])('%s cannot update anyone', async (_n, c) => {
    await rejects(updateUser(w.deps, c, { uid: 'drv1', name: 'x' }), 'permission-denied', 'forbidden')
  })
  it('a driver or security contact number is contact info only: no Auth change, can be cleared', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', phone: '0712223333' })
    expect(w.users.get('drv1')?.phone).toBe('94712223333')
    expect(w.authUsers.has('drv1')).toBe(false)
    await updateUser(w.deps, admin(), { uid: 'drv1', phone: null })
    expect(w.users.get('drv1')?.phone).toBeNull()
    expect(w.drivers.get('drv1')?.phone).toBeNull()
    await updateUser(w.deps, admin(), { uid: 'sec', phone: '0712223333' })
    expect(w.users.get('sec')?.phone).toBe('94712223333')
  })
  it('rejects phone for office staff, invalid phones and empty updates', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', phone: '0712223333' }), 'invalid-argument')
    await rejects(updateUser(w.deps, admin(), { uid: 'drv1', phone: '123' }), 'invalid-argument')
    await rejects(updateUser(w.deps, admin(), { uid: 'drv1' }), 'invalid-argument')
  })
  it('does not accept role or tenant changes', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', name: 'Same', role: 'admin', tenantId: 'T2' })
    expect(w.users.get('drv1')).toMatchObject({ role: 'driver', tenantId: 'T1' })
  })
})

describe('resetCredential', () => {
  it.each(['drv1', 'sec'])('refuses PIN users (%s) and points to reissuePin', async (uid) => {
    await rejects(resetCredential(w.deps, admin(), { uid, newPassword: 'a-good-password' }), 'failed-precondition', 'pin-user')
    expect(w.revoked).toHaveLength(0)
  })
  it('office staff: flag set, tokens revoked, password validated', async () => {
    await rejects(resetCredential(w.deps, admin(), { uid: 'officer', newPassword: '123456' }), 'invalid-argument')
    await resetCredential(w.deps, admin(), { uid: 'officer', newPassword: 'a-good-password' })
    expect(w.users.get('officer')?.mustChangePassword).toBe(true)
    expect(w.authUsers.get('officer')?.password).toBe('a-good-password')
    expect(w.revoked).toContain('officer')
  })
  it('supervisor manages no staff passwords', async () => {
    await rejects(resetCredential(w.deps, sup1(), { uid: 'drv2', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
    await rejects(resetCredential(w.deps, sup1(), { uid: 'admin', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
  })
  it('rejects cross-tenant targets and self reset', async () => {
    await rejects(resetCredential(w.deps, admin(), { uid: 'foreign', newPassword: 'a-good-password' }), 'permission-denied', 'tenant-mismatch')
    await rejects(resetCredential(w.deps, admin(), { uid: 'admin', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
  })
  it('a tenant admin cannot reset another admin', async () => {
    w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
    await rejects(resetCredential(w.deps, admin(), { uid: 'admin2', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
    expect(w.revoked).toHaveLength(0)
    expect(w.users.get('admin2')?.mustChangePassword).toBe(false)
  })
  it('officer and driver cannot reset', async () => {
    await rejects(resetCredential(w.deps, caller('officer', 'officer'), { uid: 'sup1', newPassword: 'a-good-password' }), 'permission-denied')
    await rejects(resetCredential(w.deps, caller('drv1', 'driver', 'C1'), { uid: 'drv1', newPassword: 'a-good-password' }), 'permission-denied')
  })
})

describe('changeOwnPassword', () => {
  it.each([
    ['driver', caller('drv1', 'driver', 'C1')],
    ['security', caller('sec', 'security')],
  ])('refuses %s: they sign in with a PIN', async (_n, c) => {
    await rejects(changeOwnPassword(w.deps, c, { newPassword: 'a-good-password' }), 'failed-precondition', 'pin-user')
  })
  it('validates staff passwords', async () => {
    await rejects(changeOwnPassword(w.deps, admin(), { newPassword: '123456' }), 'invalid-argument')
    await changeOwnPassword(w.deps, admin(), { newPassword: 'a-good-password' })
  })
  it('requires a sign-in within the last 5 minutes', async () => {
    await changeOwnPassword(w.deps, caller('admin', 'admin', null, { authTime: NOW - 299 }), { newPassword: 'a-good-password' })
    await rejects(
      changeOwnPassword(w.deps, caller('admin', 'admin', null, { authTime: NOW - 301 }), { newPassword: 'a-good-password' }),
      'failed-precondition',
      'recent-login-required',
    )
  })
  it('only affects the caller: there is no uid input', async () => {
    await changeOwnPassword(w.deps, admin(), { newPassword: 'a-good-password', uid: 'drv1' })
    expect(w.authUsers.has('drv1')).toBe(false)
    expect(w.authUsers.get('admin')?.password).toBe('a-good-password')
  })
})

describe('reissuePin', () => {
  const pinUser = async (): Promise<{ uid: string; pin: string }> => {
    const r = await createUser(w.deps, admin(), driverInput)
    return { uid: r.uid, pin: r.pin as string }
  }

  it('replaces the PIN at once, revokes sessions, clears known devices, audits without the PIN', async () => {
    const { uid, pin: old } = await pinUser()
    w.users.set(uid, { ...(w.users.get(uid) as NonNullable<ReturnType<typeof w.users.get>>), knownDevices: { abc: {} } } as never)
    const { pin } = await reissuePin(w.deps, admin(), { uid })
    expect(pin).toMatch(/^\d{8}$/)
    expect(pin).not.toBe(old)
    expect(w.pins.has(pinKey(old, TEST_PEPPER))).toBe(false)
    expect(w.pins.get(pinKey(pin, TEST_PEPPER))).toEqual({ uid, tenantId: 'T1', role: 'driver' })
    expect(w.revoked).toContain(uid)
    expect(w.users.get(uid)).toMatchObject({ sessionsRevokedAt: NOW, pinVersion: 2, loginType: 'pin' })
    expect(w.users.get(uid)).not.toHaveProperty('knownDevices')
    expect(w.audits.at(-1)).toMatchObject({ action: 'user.reissuePin', targetId: uid })
    expect(JSON.stringify(w.audits)).not.toContain(pin)
  })

  it('a session from before the reissue is refused with session-expired', async () => {
    const { uid } = await pinUser()
    await reissuePin(w.deps, admin(), { uid })
    await rejects(changeOwnPassword(w.deps, caller(uid, 'driver', 'C1', { authTime: NOW - 1 }), { newPassword: 'x' }), 'unauthenticated', 'session-expired')
  })

  it('same scope as resetCredential: supervisors only for drivers of their own contractor', async () => {
    await rejects(reissuePin(w.deps, caller('drv1', 'driver', 'C1'), { uid: 'drv1' }), 'permission-denied', 'forbidden')
    await reissuePin(w.deps, sup1(), { uid: 'drv1' })
    await rejects(reissuePin(w.deps, sup1(), { uid: 'drv2' }), 'permission-denied', 'forbidden')
    await rejects(reissuePin(w.deps, sup1(), { uid: 'sec' }), 'permission-denied', 'forbidden')
    await reissuePin(w.deps, admin(), { uid: 'sec' })
    await rejects(reissuePin(w.deps, admin(), { uid: 'foreign' }), 'permission-denied', 'tenant-mismatch')
    await rejects(reissuePin(w.deps, caller('officer', 'officer'), { uid: 'drv1' }), 'permission-denied', 'forbidden')
  })

  it('refuses office staff', async () => {
    await rejects(reissuePin(w.deps, admin(), { uid: 'officer' }), 'failed-precondition', 'not-pin-user')
    await rejects(reissuePin(w.deps, admin(), { uid: 'admin2' }), 'permission-denied', 'forbidden')
  })

  it('an account that predates PIN login gets a credential-free Auth user with the same uid and claims', async () => {
    w.authUsers.set('sec', { email: 'sec@x.com', password: 'old-password', disabled: false, displayName: 'Sam' })
    w.claims.set('sec', { role: 'security', tenantId: 'T1' })
    await reissuePin(w.deps, admin(), { uid: 'sec' })
    expect(w.authUsers.get('sec')).toEqual({ disabled: false, displayName: 'Name' })
    expect(w.claims.get('sec')).toEqual({ role: 'security', tenantId: 'T1' })
    expect(w.users.get('sec')?.loginType).toBe('pin')
  })
})

describe('revealPin', () => {
  const pinUser = async (): Promise<{ uid: string; pin: string }> => {
    const r = await createUser(w.deps, admin(), driverInput)
    return { uid: r.uid, pin: r.pin as string }
  }

  it('shows the PIN issued at creation, and audits the view without the PIN', async () => {
    const { uid, pin } = await pinUser()
    expect((await revealPin(w.deps, admin(), { uid })).pin).toBe(pin)
    expect(w.audits.at(-1)).toMatchObject({ action: 'user.revealPin', targetId: uid })
    expect(JSON.stringify(w.audits)).not.toContain(pin)
    expect(JSON.stringify([...w.vaults.values()])).not.toContain(pin)
  })

  it('shows the new PIN after a reissue, never the old one', async () => {
    const { uid, pin: old } = await pinUser()
    const { pin } = await reissuePin(w.deps, admin(), { uid })
    const shown = (await revealPin(w.deps, admin(), { uid })).pin
    expect(shown).toBe(pin)
    expect(shown).not.toBe(old)
  })

  it('a supervisor sees only the PINs of drivers of their own contractor', async () => {
    const { uid } = await pinUser()
    await revealPin(w.deps, sup1(), { uid })
    await rejects(revealPin(w.deps, sup1(), { uid: 'sec' }), 'permission-denied', 'forbidden')
    await rejects(revealPin(w.deps, caller('officer', 'officer'), { uid }), 'permission-denied', 'forbidden')
    await rejects(revealPin(w.deps, caller('drv1', 'driver', 'C1'), { uid }), 'permission-denied', 'forbidden')
  })

  it('an account issued before viewing existed has no stored PIN: reissue', async () => {
    await rejects(revealPin(w.deps, admin(), { uid: 'drv1' }), 'failed-precondition', 'pin-not-stored')
  })

  it('refuses office staff and other tenants', async () => {
    await rejects(revealPin(w.deps, admin(), { uid: 'officer' }), 'failed-precondition', 'not-pin-user')
    await rejects(revealPin(w.deps, admin(), { uid: 'foreign' }), 'permission-denied', 'tenant-mismatch')
  })

  it('a sealed value does not open for another uid, version or pepper', () => {
    const sealed = sealPin('48201357', 'u1', 2, TEST_PEPPER)
    expect(openPin(sealed, 'u1', 2, TEST_PEPPER)).toBe('48201357')
    expect(openPin(sealed, 'u2', 2, TEST_PEPPER)).toBeNull()
    expect(openPin(sealed, 'u1', 3, TEST_PEPPER)).toBeNull()
    expect(openPin(sealed, 'u1', 2, `${TEST_PEPPER}-other`)).toBeNull()
    expect(openPin('not base64 !!', 'u1', 2, TEST_PEPPER)).toBeNull()
  })
})

describe('Module 2: drivers doc', () => {
  it('createUser(driver) also creates drivers/{uid}, with optional licenseNo', async () => {
    const { uid } = await createUser(w.deps, admin(), { ...driverInput, licenseNo: ' B1234567 ' })
    expect(w.drivers.get(uid)).toEqual({
      tenantId: 'T1',
      contractorId: 'C1',
      name: 'Drv',
      phone: '94779998888',
      status: 'active',
      licenseNo: 'B1234567',
    })
  })
  it('createUser(driver) without licenseNo omits it; staff get no drivers doc and cannot have a licence', async () => {
    const { uid } = await createUser(w.deps, sup1(), driverInput)
    expect(w.drivers.get(uid)).not.toHaveProperty('licenseNo')
    const staff = await createUser(w.deps, admin(), staffInput)
    expect(w.drivers.has(staff.uid)).toBe(false)
    await rejects(createUser(w.deps, admin(), { ...staffInput, email: 'o2@x.com', licenseNo: 'X1' }), 'invalid-argument')
  })
  it('updateUser mirrors name, phone and status into drivers', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', name: 'New', phone: '0712223333' })
    expect(w.drivers.get('drv1')).toMatchObject({ name: 'New', phone: '94712223333' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    expect(w.drivers.get('drv1')?.status).toBe('disabled')
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'active' })
    expect(w.drivers.get('drv1')?.status).toBe('active')
  })
  it('updateUser sets and clears licenseNo for drivers only', async () => {
    await updateUser(w.deps, sup1(), { uid: 'drv1', licenseNo: 'L-99' })
    expect(w.drivers.get('drv1')?.licenseNo).toBe('L-99')
    await updateUser(w.deps, sup1(), { uid: 'drv1', licenseNo: null })
    expect(w.drivers.get('drv1')?.licenseNo).toBeNull()
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', licenseNo: 'L-99' }), 'invalid-argument', 'invalid-input')
  })
  it('accepts only the canonical photo path of that driver', async () => {
    const good = 'tenants/T1/contractors/C1/drivers/drv1.jpg'
    await updateUser(w.deps, sup1(), { uid: 'drv1', photoPath: good })
    expect(w.drivers.get('drv1')?.photoPath).toBe(good)
    for (const bad of [
      'tenants/T1/contractors/C2/drivers/drv1.jpg',
      'tenants/T2/contractors/C1/drivers/drv1.jpg',
      'tenants/T1/contractors/C1/drivers/drv1b.jpg',
      'tenants/T1/contractors/C1/drivers/drv1.png',
      'tenants/T1/contractors/C1/drivers/drv1.jpg/../x.jpg',
      '/tenants/T1/contractors/C1/drivers/drv1.jpg',
      'tenants/T1/contractors/C1/drivers/drv1.jpg ',
    ]) {
      await rejects(updateUser(w.deps, admin(), { uid: 'drv1', photoPath: bad }), 'invalid-argument', 'photo-path-invalid')
    }
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', photoPath: good }), 'invalid-argument')
  })
  it('supervisor still cannot touch another contractor’s driver photo', async () => {
    await rejects(
      updateUser(w.deps, sup1(), { uid: 'drv2', photoPath: 'tenants/T1/contractors/C2/drivers/drv2.jpg' }),
      'permission-denied',
      'forbidden',
    )
  })
  it('backfills the drivers doc for drivers that predate Module 2', async () => {
    w.drivers.delete('drv1')
    await updateUser(w.deps, admin(), { uid: 'drv1', licenseNo: 'L-1' })
    expect(w.drivers.get('drv1')).toEqual({
      tenantId: 'T1',
      contractorId: 'C1',
      name: 'Name',
      phone: '94771234567',
      status: 'active',
      licenseNo: 'L-1',
    })
  })
})

describe('Module 2: suspended contractors lock their users out server-side', () => {
  it('a supervisor or driver of a suspended contractor is rejected on every call', async () => {
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(updateUser(w.deps, sup1(), { uid: 'drv1', name: 'x' }), 'permission-denied', 'caller-not-active')
    await rejects(updateUser(w.deps, caller('drv1', 'driver', 'C1'), { uid: 'drv1', name: 'x' }), 'permission-denied', 'caller-not-active')
  })
  it('rejects a caller whose users doc contractor differs from the token', async () => {
    await rejects(updateUser(w.deps, caller('sup1', 'supervisor', 'C2'), { uid: 'drv2', name: 'x' }), 'permission-denied', 'caller-not-active')
  })
})
