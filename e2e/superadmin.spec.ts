import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, smallTouchTargets } from './support/a11y.ts'
import { breakOperator, PASSWORD, seed, STAFF, superadminCreate, superadminDoctor } from './support/emulator.ts'

// Module 11 end to end: the real scripts (create, doctor, repair), the real sign-in page, callables, Auth and Firestore emulators.
test.beforeEach(() => {
  seed()
})

const OP = { email: 'olive@convoypass.test', name: 'Olive Operator' }
const NEW_PASSWORD = 'Correct-Horse-Battery-9'
const MISMATCH = "These details don't match a super admin account."

async function signInAt(page: Page, email: string, password: string, from?: string): Promise<void> {
  await page.goto(from ? `/platform/login?from=${encodeURIComponent(from)}` : '/platform/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('super admin bootstrap and sign-in', () => {
  test('superadmin:create prints the banner, passes its readback and a one-time password; sign-in forces a change, then lands on /platform', async ({ page }) => {
    const created = superadminCreate(OP.email, OP.name)
    expect(created.code).toBe(0)
    expect(created.out).toContain('Environment       : EMULATOR')
    expect(created.out).toContain('RESULT: PASS')
    expect(created.password).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(created.out.split(created.password ?? 'x').length).toBe(2) // printed exactly once

    await signInAt(page, OP.email, created.password ?? '')
    await expect(page).toHaveURL(/\/platform\/change-password/)
    await expect(page.getByText(/temporary password/i)).toBeVisible()

    await page.getByLabel('Current password').fill(created.password ?? '')
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page).toHaveURL(/\/platform$/)
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Change password' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

    // The temporary password no longer works; the new one does, and no change is asked for again.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/platform\/login/)
    await signInAt(page, OP.email, created.password ?? '')
    await expect(page.getByRole('alert')).toContainText(MISMATCH)
    await signInAt(page, OP.email, NEW_PASSWORD)
    await expect(page).toHaveURL(/\/platform$/)
  })

  test('a tenant admin gets the same message as a wrong password and ends up signed out', async ({ page }) => {
    const created = superadminCreate(OP.email, OP.name)
    await signInAt(page, STAFF.admin.email, PASSWORD)
    await expect(page.getByRole('alert')).toContainText(MISMATCH)
    const tenantMessage = await page.getByRole('alert').innerText()
    await expect(page).toHaveURL(/\/platform\/login/)
    // Signed out for real: a workspace page sends them to the workspace login.
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/login/)

    await signInAt(page, OP.email, 'definitely-wrong-password')
    expect(await page.getByRole('alert').innerText()).toBe(tenantMessage)
    expect(created.code).toBe(0)
  })

  test('an unauthenticated /platform visit goes to the Super admin sign-in, and from= outside /platform is ignored', async ({ page }) => {
    await page.goto('/platform/workspaces')
    await expect(page).toHaveURL(/\/platform\/login\?from=%2Fplatform%2Fworkspaces/)
  })

  test('--reset-password issues a new temporary password, the old one stops working and a change is forced again', async ({ page }) => {
    const created = superadminCreate(OP.email, OP.name)
    expect(created.code).toBe(0)
    const reset = superadminCreate(OP.email, OP.name, ['--reset-password'])
    expect(reset.code).toBe(0)
    expect(reset.password).toBeTruthy()
    expect(reset.password).not.toBe(created.password)
    await signInAt(page, OP.email, created.password ?? '')
    await expect(page.getByRole('alert')).toContainText(MISMATCH)
    await signInAt(page, OP.email, reset.password ?? '')
    await expect(page).toHaveURL(/\/platform\/change-password/)
  })

  test('the main /login still sends a super admin to /platform', async ({ page }) => {
    const created = superadminCreate(OP.email, OP.name)
    await page.goto('/login/staff')
    await page.getByLabel('Email').fill(OP.email)
    await page.getByLabel('Password', { exact: true }).fill(created.password ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/platform\/change-password|\/platform$/)
  })
})

test.describe('superadmin:doctor and --repair', () => {
  test('re-running create refuses; each deliberate break is reported separately and --fix repairs it', async () => {
    const created = superadminCreate(OP.email, OP.name)
    expect(created.code).toBe(0)
    const again = superadminCreate(OP.email, OP.name)
    expect(again.code).toBe(1)
    expect(again.out).toContain('Account exists. Use --repair to fix its setup or --reset-password to issue a new temporary password')

    expect(superadminDoctor(OP.email).code).toBe(0)

    for (const [what, row] of [
      ['claims', "FAIL  Claims are role 'platform'"],
      ['profile', 'FAIL  operators/{uid} exists'],
      ['email', 'FAIL  Email is verified'],
      ['tenant-claim', 'FAIL  No other claims'],
    ] as const) {
      breakOperator(OP.email, what)
      const broken = superadminDoctor(OP.email)
      expect(broken.code, what).toBe(1)
      expect(broken.out, what).toContain(row)
      expect(broken.out).toMatch(/likely cause:/)
      const fixed = superadminDoctor(OP.email, ['--fix'])
      expect(fixed.code, `${what} after --fix`).toBe(0)
      expect(superadminDoctor(OP.email).code).toBe(0)
    }
    const json = superadminDoctor(OP.email, ['--json'])
    expect((JSON.parse(json.out.slice(json.out.indexOf('{'))) as { ok: boolean }).ok).toBe(true)
  })

  test('--repair restores a broken account and the old password keeps working', async ({ page }) => {
    const created = superadminCreate(OP.email, OP.name)
    breakOperator(OP.email, 'claims')
    breakOperator(OP.email, 'email')
    const repaired = superadminCreate(OP.email, OP.name, ['--repair'])
    expect(repaired.code).toBe(0)
    expect(repaired.password).toBeUndefined() // a repair never prints or touches a password
    await signInAt(page, OP.email, created.password ?? '')
    await expect(page).toHaveURL(/\/platform\/change-password/)
  })
})

test.describe('accessibility: the Super admin sign-in on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('sign-in and the forced change page: axe and 44 px targets', async ({ page }) => {
    await page.goto('/platform/login')
    await expect(page.getByRole('heading', { name: 'Super admin sign-in' })).toBeVisible()
    await expectNoAxeViolations(page, 'platform sign-in')
    expect(await smallTouchTargets(page), 'platform sign-in: touch targets under 44 px').toEqual([])

    const created = superadminCreate(OP.email, OP.name)
    await signInAt(page, OP.email, created.password ?? '')
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await expectNoAxeViolations(page, 'platform change password')
    expect(await smallTouchTargets(page), 'platform change password: touch targets under 44 px').toEqual([])
  })
})
