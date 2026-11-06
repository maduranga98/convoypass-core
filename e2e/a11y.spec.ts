import { expect, test, type Page } from '@playwright/test'
import { seed, VEHICLE, writePass } from './support/emulator.ts'
import { expectNoAxeViolations, smallTouchTargets } from './support/a11y.ts'
import { loginDriver, loginStaff } from './support/ui.ts'

// Every test starts from the same clean tenant: earlier tests leave passes and notifications behind otherwise.
test.beforeEach(() => {
  seed()
})

// A phone: coarse pointer, 390 x 844. These are the three mobile-first roles.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

async function audit(page: Page, what: string): Promise<void> {
  await page.waitForTimeout(800) // Firestore listeners keep the network busy, so 'networkidle' never comes
  await expectNoAxeViolations(page, what)
  expect(await smallTouchTargets(page), `${what}: touch targets under 44 px`).toEqual([])
}

test.describe('accessibility: login', () => {
  test('PIN screen, staff form and privacy', async ({ page }) => {
    await page.goto('/login')
    await audit(page, 'login: PIN')
    await page.getByRole('link', { name: 'Office staff? Sign in with email' }).click()
    await audit(page, 'login: staff')
    await page.getByRole('link', { name: 'Privacy' }).click()
    await audit(page, 'privacy')
  })
})

test.describe('accessibility: driver', () => {
  test('home, the pre-trip form and the camera', async ({ page }) => {
    await loginDriver(page)
    await audit(page, 'driver home')
    await page.goto(`/v/${VEHICLE}`)
    await expect(page.getByRole('heading', { name: /WP LJ-4821|Pre-trip|check/i }).first()).toBeVisible()
    await audit(page, 'driver pre-trip form')
    await page.getByRole('button', { name: /GPS device/i }).first().click()
    await expect(page.getByRole('button', { name: /^capture$/i })).toBeVisible()
    await audit(page, 'driver camera')
  })
  test('notifications and settings', async ({ page }) => {
    await loginDriver(page)
    await page.goto('/notifications')
    await audit(page, 'driver notifications')
    await page.goto('/settings')
    await audit(page, 'driver settings')
  })
})

test.describe('accessibility: supervisor', () => {
  test('home, approvals, review, vehicles and the bell panel', async ({ page }) => {
    const passId = writePass('submitted')
    await loginStaff(page, 'supervisor')
    await audit(page, 'supervisor home')
    await page.getByRole('button', { name: /Notifications/ }).click()
    await expect(page.getByRole('region', { name: 'Notifications', exact: true })).toBeVisible()
    await audit(page, 'supervisor bell panel')
    await page.keyboard.press('Escape')
    await page.goto('/supervisor/approvals')
    await audit(page, 'supervisor approvals')
    await page.goto(`/supervisor/approvals/${passId}`)
    await expect(page.getByRole('button', { name: /approve/i }).first()).toBeVisible()
    await audit(page, 'supervisor review')
    await page.goto('/supervisor/vehicles')
    await audit(page, 'supervisor vehicles')
  })
})

test.describe('accessibility: security', () => {
  test('gate home, the vehicle view with check-in, the queue and the scanner', async ({ page }) => {
    writePass('officer_approved')
    await loginStaff(page, 'security')
    await audit(page, 'gate home')
    await page.goto(`/v/${VEHICLE}`)
    await expect(page.getByRole('button', { name: /^let in/i })).toBeVisible()
    await audit(page, 'gate vehicle view')
    await page.goto('/security/queue')
    await audit(page, 'gate queue')
    await page.goto('/security')
    await page.getByRole('button', { name: /scan/i }).first().click()
    await audit(page, 'gate scanner explainer')
    await page.getByRole('button', { name: 'OK, open camera' }).click()
    await audit(page, 'gate scanner')
  })
})


test.describe('accessibility: supervisor lists', () => {
  test('drivers, QR labels, approvals tabs and the settings page', async ({ page }) => {
    await loginStaff(page, 'supervisor')
    for (const [path, what] of [['/supervisor/drivers', 'supervisor drivers'], ['/supervisor/qr', 'supervisor qr'], ['/settings', 'supervisor settings'], ['/notifications', 'supervisor notifications']] as const) {
      await page.goto(path)
      await audit(page, what)
    }
  })
})

test.describe('accessibility: admin audit log (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })
  test('filters, table and detail drawer', async ({ page }) => {
    await loginStaff(page, 'admin')
    await page.goto('/admin/audit')
    await expect(page.getByRole('table')).toBeVisible()
    await expectNoAxeViolations(page, 'audit log')
    await page.getByRole('button', { name: /Audit entry: User created/ }).first().click()
    await expect(page.getByTestId('audit-meta')).toBeVisible()
    await expectNoAxeViolations(page, 'audit entry drawer')
  })
})
