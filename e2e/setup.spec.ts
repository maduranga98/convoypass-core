import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { adminReset, createInvite, expireInvite, oobCodeFromLink, oobCodes, PASSWORD, seed, STAFF, tenantByName } from './support/emulator.ts'
import { expectNoAxeViolations, smallTouchTargets } from './support/a11y.ts'

// Module 8 end to end: the real operator scripts, callables, rules, Auth emulator and client.
test.beforeEach(() => {
  seed()
})

const OWNER = { email: 'owner@acme.test', password: 'Correct-horse-battery-9', name: 'Olive Owner', company: 'Acme Quarry' }
const INVALID = 'This setup link is invalid or has expired.'

async function completeSetup(page: Page, link: string, who = OWNER): Promise<void> {
  await page.goto(link)
  await expect(page.getByLabel('Company name')).toBeVisible()
  await page.getByLabel('Company name').fill(who.company)
  await page.getByLabel('Your full name').fill(who.name)
  const email = page.getByLabel('Work email')
  if (!(await email.evaluate((el) => (el as HTMLInputElement).readOnly))) await email.fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByLabel('Confirm password').fill(who.password)
  await page.getByRole('button', { name: 'Create workspace' }).click()
}

async function loginWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login/staff')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const pageText = async (page: Page): Promise<string> => (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim()

test.describe('invite link -> workspace', () => {
  test('invite:create prints a link; opening it, completing setup signs the new admin in on a ready dashboard', async ({ page }) => {
    const invite = createInvite({ company: OWNER.company, lockEmail: OWNER.email })
    expect(invite.link).toMatch(/^http:\/\/127\.0\.0\.1:5173\/setup#code=[A-Za-z0-9_-]{43}$/)

    await page.goto(invite.link)
    await expect(page.getByLabel('Company name')).toHaveValue(OWNER.company)
    // The code is gone from the address bar and from every kind of storage.
    await expect(page).toHaveURL('http://127.0.0.1:5173/setup')
    expect(await page.evaluate(() => JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]) + document.cookie)).not.toContain(invite.code)
    // The locked email is prefilled and read only; the timezone defaults to Colombo.
    await expect(page.getByLabel('Work email')).toHaveValue(OWNER.email)
    await expect(page.getByLabel('Work email')).toHaveJSProperty('readOnly', true)
    await expect(page.getByLabel('Timezone')).toHaveValue('Asia/Colombo')

    await page.getByLabel('Your full name').fill(OWNER.name)
    // Live rules, and mismatch is blocked
    await page.getByLabel('Password', { exact: true }).fill('Password1234')
    await expect(page.getByTestId('password-rules').locator('li[data-met="false"]')).toHaveCount(1)
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await expect(page.getByTestId('password-rules').locator('li[data-met="false"]')).toHaveCount(0)
    await page.getByLabel('Confirm password').fill('Something-different-1')
    await page.getByRole('button', { name: 'Create workspace' }).click()
    await expect(page.getByText('Passwords do not match')).toBeVisible()
    await page.getByLabel('Confirm password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Create workspace' }).click()

    // Signed in, on the dashboard, with the welcome toast, without ?welcome, and the onboarding card.
    await expect(page).toHaveURL('http://127.0.0.1:5173/admin/dashboard')
    await expect(page.getByText('Welcome to ConvoyPass. Your workspace is ready.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Get ConvoyPass ready' })).toBeVisible()
    await expect(page.getByText('0 of 7 done')).toBeVisible()
  })

  test('the tenant has every default, and the new admin can use the app (contractor, settings, onboarding ticks)', async ({ page }) => {
    const invite = createInvite()
    await completeSetup(page, invite.link)
    await expect(page).toHaveURL(/\/admin\/dashboard$/)

    await page.goto('/admin/contractors')
    await page.getByRole('button', { name: 'New contractor' }).first().click()
    await page.getByLabel('Company name').fill('Lanka Haulage')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Lanka Haulage').first()).toBeVisible()

    await page.goto('/admin/settings')
    await expect(page.locator('input[value="Dashcam is recording"]')).toBeVisible()
    await expect(page.locator('input[value="Main Gate"]')).toBeVisible()
    await page.goto('/admin/dashboard')
    await expect(page.getByText('2 of 7 done')).toBeVisible() // contractor + settings visited
  })

  test('the stored tenant carries every default later modules read', async ({ page }) => {
    await completeSetup(page, createInvite().link)
    await expect(page).toHaveURL(/\/admin\/dashboard$/)
    const tenant = tenantByName(OWNER.company)
    expect(tenant.id).toMatch(/^ten_[a-z0-9]{10}$/)
    expect(tenant).toMatchObject({
      name: OWNER.company, status: 'active', timezone: 'Asia/Colombo', retentionDays: 0,
      sla: { supervisorMinutes: 30, officerMinutes: 30 }, passSettings: { requireLocation: false, maxExtraPhotos: 2 },
      gates: [{ id: 'main', name: 'Main Gate' }],
    })
    expect((tenant.checklist as unknown[]).length).toBe(5)
    expect((tenant.rejectionReasons as { id: string }[]).map((r) => r.id)).toContain('other')
  })
})

test.describe('uniform invalid-link answers', () => {
  test('a reused link, an expired one and garbage all show the identical message', async ({ browser, page }) => {
    const used = createInvite()
    await completeSetup(page, used.link)
    await expect(page).toHaveURL(/\/admin\/dashboard$/)

    const expired = createInvite()
    expireInvite(expired.hashPrefix)
    const texts: string[] = []
    const visit = async (url: string) => {
      const ctx = await browser.newContext()
      const p = await ctx.newPage()
      await p.goto(url)
      await expect(p.getByText(INVALID)).toBeVisible()
      texts.push(await pageText(p))
      await ctx.close()
    }
    await visit(used.link)
    await visit(expired.link)
    await visit(`/setup#code=${'x'.repeat(43)}`)
    await visit('/setup#code=short')
    await visit('/setup')
    await visit(`/setup?code=${used.code}`) // never accepted from the query string
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toContain('Ask your ConvoyPass contact for a new link.')
  })

  test('a locked invite shows a read-only email and cannot be used for another address', async ({ page, request }) => {
    const invite = createInvite({ lockEmail: 'only@acme.test' })
    await page.goto(invite.link)
    await expect(page.getByLabel('Work email')).toHaveValue('only@acme.test')
    await expect(page.getByLabel('Work email')).toHaveJSProperty('readOnly', true)
    // Bypassing the UI: the callable itself refuses with the same uniform answer.
    const res = await request.post('http://127.0.0.1:5001/demo-conveypass-e2e/asia-south1/completeSetup', {
      data: { data: { code: invite.code, companyName: 'Evil Co', adminName: 'Eve', email: 'eve@evil.test', password: 'Correct-horse-battery-9', timezone: 'Asia/Colombo' } },
    })
    expect((await res.json()).error).toMatchObject({ status: 'FAILED_PRECONDITION', message: INVALID })
  })
})

test.describe('staff forgot password', () => {
  test('same confirmation for known and unknown emails; the emulator email completes the reset; the new password signs in', async ({ page }) => {
    await page.goto('/login/staff')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)

    const confirmation = async (email: string): Promise<string> => {
      await page.goto('/forgot-password')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send reset link' }).click()
      await expect(page.getByText("If an account exists for this email, we've sent a reset link.")).toBeVisible()
      await expect(page.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled()
      return pageText(page)
    }
    const unknown = await confirmation('nobody@e2e.test')
    const known = await confirmation(STAFF.supervisor.email)
    expect(known.replace(STAFF.supervisor.email, '')).toBe(unknown.replace('nobody@e2e.test', ''))
    expect(await oobCodes('nobody@e2e.test')).toHaveLength(0)

    const oobCode = (await oobCodes(STAFF.supervisor.email, 'PASSWORD_RESET'))[0]!.oobCode
    await page.goto(`/auth/action?mode=resetPassword&oobCode=${oobCode}&apiKey=fake-api-key&lang=en`)
    await expect(page.getByText(`For ${STAFF.supervisor.email}`)).toBeVisible()
    await expect(page.getByText(oobCode)).toHaveCount(0)
    await page.getByLabel('New password').fill('Password1234')
    await page.getByLabel('Confirm password').fill('Password1234')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByText('Choose a password that meets every rule below.')).toBeVisible()
    await page.getByLabel('New password').fill('Brand-new-staple-42')
    await page.getByLabel('Confirm password').fill('Brand-new-staple-42')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()

    // The link is single use.
    await page.goto(`/auth/action?mode=resetPassword&oobCode=${oobCode}`)
    await expect(page.getByText('This link has expired or was already used.').or(page.getByText('This link is not valid.'))).toBeVisible()
    await expect(page.getByRole('link', { name: 'Request a new reset link' })).toBeVisible()

    await loginWith(page, STAFF.supervisor.email, PASSWORD)
    await expect(page.getByText('Incorrect details. Please check and try again.')).toBeVisible()
    await loginWith(page, STAFF.supervisor.email, 'Brand-new-staple-42')
    await expect(page).toHaveURL(/\/supervisor/)
  })

  test('the PIN screen has no reset link; it links office staff to the email form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Office staff? Sign in with email' }).click()
    await expect(page).toHaveURL(/\/login\/staff/)
    await expect(page.getByText(/PIN/)).toHaveCount(0)
  })
})

test.describe('account: change password with re-authentication', () => {
  test('a wrong current password fails; the right one changes it and the device stays signed in', async ({ page }) => {
    await loginWith(page, STAFF.officer.email, PASSWORD)
    await expect(page).toHaveURL(/\/officer/)
    await page.goto('/settings')
    await expect(page.getByText(STAFF.officer.email)).toBeVisible()
    await expect(page.getByText('Officer', { exact: true })).toBeVisible()

    const fill = async (current: string, next: string) => {
      await page.getByLabel('Current password').fill(current)
      await page.getByLabel('New password', { exact: true }).fill(next)
      await page.getByLabel('Confirm new password').fill(next)
      await page.getByRole('button', { name: 'Update password' }).click()
    }
    await fill('not-my-password-1', 'Fresh-staple-battery-7')
    await expect(page.getByText('That is not your current password.')).toBeVisible()
    await fill(PASSWORD, 'Fresh-staple-battery-7')
    await expect(page.getByText('Password updated. You stay signed in on this device.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible() // still signed in after a reload
    // The new password works; the old one does not.
    await page.context().clearCookies()
    await page.evaluate(() => indexedDB.deleteDatabase('firebaseLocalStorageDb'))
    await loginWith(page, STAFF.officer.email, PASSWORD)
    await expect(page.getByText('Incorrect details. Please check and try again.')).toBeVisible()
    await loginWith(page, STAFF.officer.email, 'Fresh-staple-battery-7')
    await expect(page).toHaveURL(/\/officer/)
  })
})

test.describe('admin recovery (operator script)', () => {
  test('--temp-password: the admin signs in with it and must choose a new password', async ({ page }) => {
    const temp = adminReset(STAFF.admin.email, '--temp-password')
    await loginWith(page, STAFF.admin.email, temp)
    await expect(page).toHaveURL(/\/change-password/)
    await page.getByLabel('New password').fill('Recovered-admin-pass-1')
    await page.getByLabel('Confirm password').fill('Recovered-admin-pass-1')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page).toHaveURL(/\/admin/)
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
  })

  test('--link: the printed reset link completes through the app action page', async ({ page }) => {
    const link = adminReset(STAFF.admin.email, '--link')
    await page.goto(`/auth/action?mode=resetPassword&oobCode=${oobCodeFromLink(link)}`)
    await page.getByLabel('New password').fill('Linked-admin-pass-1')
    await page.getByLabel('Confirm password').fill('Linked-admin-pass-1')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()
    await loginWith(page, STAFF.admin.email, 'Linked-admin-pass-1')
    await expect(page).toHaveURL(/\/admin/)
  })

  test('refuses an account that is not an admin', () => {
    expect(() => adminReset(STAFF.supervisor.email, '--temp-password')).toThrow()
    expect(() => adminReset(STAFF.officer.email, '--link')).toThrow()
  })
})

// ---- accessibility on a phone ---------------------------------------------------------------------------------------

test.describe('accessibility: the new screens on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  async function audit(page: Page, what: string): Promise<void> {
    await page.waitForTimeout(600)
    await expectNoAxeViolations(page, what)
    expect(await smallTouchTargets(page), `${what}: touch targets under 44 px`).toEqual([])
  }

  test('login links, forgot password, setup (form and invalid), action page', async ({ page }) => {
    await page.goto('/login/staff')
    await audit(page, 'login with forgot link')
    await page.goto('/login')
    await audit(page, 'PIN screen')
    await page.goto('/forgot-password')
    await audit(page, 'forgot password')
    await page.getByLabel('Email').fill('someone@acme.test')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText("If an account exists for this email, we've sent a reset link.")).toBeVisible()
    await audit(page, 'forgot password confirmation')
    await page.goto('/auth/action?mode=resetPassword&oobCode=garbage')
    await expect(page.getByText(/not valid|expired/)).toBeVisible()
    await audit(page, 'action page: invalid link')
    await page.goto('/setup')
    await expect(page.getByText(INVALID)).toBeVisible()
    await audit(page, 'setup: invalid link')
    const invite = createInvite({ company: 'Acme', lockEmail: 'a11y@acme.test' })
    await page.goto(invite.link)
    await expect(page.getByLabel('Company name')).toBeVisible()
    await audit(page, 'setup form')
  })

  test('the onboarding card (new admin), and the account page', async ({ page }) => {
    const invite = createInvite()
    await completeSetup(page, invite.link)
    await expect(page.getByRole('heading', { name: 'Get ConvoyPass ready' })).toBeVisible()
    for (const selector of ['section[aria-labelledby="onboarding-h"]']) {
      const results = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(results.violations.map((v) => `${v.id}: ${v.help}`), selector).toEqual([])
    }
    const banner = await smallTouchTargets(page)
    expect(banner.filter((t) => /Dismiss|Open|Import/.test(t)), 'card touch targets').toEqual([])
    await page.goto('/settings')
    await expect(page.getByLabel('Current password')).toBeVisible()
    await audit(page, 'settings with account and change password')
  })
})

// ---- CSP: the new public pages cause no violations ----------------------------------------------------------------

test.describe('CSP report-only on the new public pages (production build, real headers)', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' })

  test('/forgot-password, /setup, /auth/action', async ({ page }) => {
    const seen: string[] = []
    page.on('console', (m) => {
      if (/content security policy|refused to (load|connect|execute|apply)/i.test(m.text())) seen.push(m.text())
    })
    await page.addInitScript(() => {
      ;(window as unknown as { __v: string[] }).__v = []
      document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __v: string[] }).__v.push(`${e.effectiveDirective} ${e.blockedURI} ${location.pathname}`))
    })
    for (const path of ['/login', '/forgot-password', '/setup', '/auth/action?mode=resetPassword&oobCode=x']) {
      await page.goto(path)
      await page.waitForTimeout(800)
      seen.push(...(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)))
    }
    expect(seen).toEqual([])
  })
})

