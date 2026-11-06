import { expect, test, type Page } from '@playwright/test'
import { seed, VEHICLE, writePass } from './support/emulator.ts'
import { loginDriver, loginStaff } from './support/ui.ts'

// Every test starts from the same clean tenant: earlier tests leave passes and notifications behind otherwise.
test.beforeEach(() => {
  seed()
})

/**
 * Acceptance: the Content-Security-Policy-Report-Only header produces no violations during a run through every role,
 * including camera capture, photo upload, the QR scanner, sign-in, the service worker, charts, reports and exports.
 * The production build is served with the real hosting headers (e2e/support/cspServer.mjs).
 */
test.use({ baseURL: 'http://127.0.0.1:5174' })

interface Violation {
  directive: string
  blocked: string
  sample: string
  page: string
}

async function watch(page: Page): Promise<() => Promise<string[]>> {
  const consoleCsp: string[] = []
  page.on('console', (m) => {
    if (/content security policy|refused to (load|connect|execute|apply)/i.test(m.text())) consoleCsp.push(m.text())
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Violation[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, page: location.pathname })
    })
  })
  return async () => {
    const seen = await page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp).catch(() => [] as Violation[])
    return [...seen.map((v) => `${v.directive} blocked ${v.blocked} on ${v.page} ${v.sample}`), ...consoleCsp]
  }
}

const reports = async (page: Page): Promise<unknown[]> =>
  (await page.request.get('/__csp_reports')).json() as Promise<unknown[]>

test('a full run through every role produces no CSP violations (report-only)', async ({ page }) => {
  const violations = await watch(page)
  // A pass for another vehicle: the supervisor has something to review, and the driver's vehicle still has no pass today.
  const reviewId = writePass('submitted', 'veh_e2etest002', 'CAB-0002')

  // The header is really the report-only policy of firebase.json, and the other security headers are there.
  const res = await page.goto('/login')
  const headers = res?.headers() ?? {}
  expect(headers['content-security-policy-report-only']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toBeUndefined()
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['permissions-policy']).toBe('camera=(self), geolocation=(self), microphone=()')
  expect(headers['cache-control']).toBe('no-cache')

  // Sign-in (Auth) and the service worker registration. /login is the PIN screen; office staff use /login/staff.
  await page.getByRole('link', { name: 'Office staff? Sign in with email' }).click()
  await page.getByLabel('Email').fill('supervisor@e2e.test')
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!e2e')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/supervisor/)
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.active || r?.installing || r?.waiting)))

  // Supervisor: home, bell, approvals, the review screen (photos from Storage), vehicles.
  await page.getByRole('button', { name: /Notifications/ }).click()
  await expect(page.getByRole('region', { name: 'Notifications', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const path of ['/supervisor/approvals', '/supervisor/vehicles', '/supervisor/drivers', '/supervisor/qr', '/settings', '/notifications']) {
    await page.goto(path)
    await page.waitForTimeout(500)
  }
  await page.goto(`/supervisor/approvals/${reviewId}`) // the review screen: photos are requested from Storage
  await expect(page.getByRole('button', { name: /approve/i }).first()).toBeVisible()
  await page.getByRole('button', { name: /sign out/i }).click()

  // Driver: home, the pre-trip form, live camera capture and the photo upload to Storage.
  await loginDriver(page)
  await page.goto(`/v/${VEHICLE}`)
  await page.getByRole('button', { name: /GPS device/i }).first().click()
  await expect(page.getByRole('button', { name: /^capture$/i })).toBeVisible()
  await page.getByRole('button', { name: /^capture$/i }).click()
  await expect(page.getByText(/uploaded/i).first()).toBeVisible({ timeout: 30_000 })
  await page.goto('/driver')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /sign out/i }).click()

  // Security: gate home, the QR scanner (camera, html5-qrcode), the vehicle view, the queue.
  await loginStaff(page, 'security')
  await page.getByRole('button', { name: /scan/i }).first().click()
  await page.getByRole('button', { name: 'OK, open camera' }).click() // first use on this browser: the camera explainer
  await page.waitForTimeout(1500)
  await page.goto(`/v/${VEHICLE}`)
  await page.waitForTimeout(800)
  await page.goto('/security/queue')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /sign out/i }).click()

  // Officer: queue, overview (charts), reports.
  await loginStaff(page, 'officer')
  for (const path of ['/officer', '/officer/overview', '/officer/reports']) {
    await page.goto(path)
    await page.waitForTimeout(800)
  }
  await page.getByRole('button', { name: /sign out/i }).click()

  // Admin: dashboard, users, reports (with an export), audit log (with a CSV export), settings, passes, QR labels.
  await loginStaff(page, 'admin')
  for (const path of ['/admin/dashboard', '/admin/users', '/admin/contractors', '/admin/vehicles', '/admin/drivers', '/admin/passes', '/admin/reports', '/admin/qr', '/admin/settings']) {
    await page.goto(path)
    await page.waitForTimeout(700)
  }
  await page.goto('/admin/audit')
  await expect(page.getByRole('table')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /export csv/i }).click()
  expect((await download).suggestedFilename()).toMatch(/^convoypass_audit_.*\.csv$/)
  await page.goto('/privacy')

  expect(await violations(), 'CSP violations seen in the page').toEqual([])
  expect(await reports(page), 'CSP reports received by /csp-report').toEqual([])
})
