import { expect, test } from '@playwright/test'
import { PLATE, seed, writePass } from './support/emulator.ts'
import { loginStaff } from './support/ui.ts'

test.beforeEach(() => {
  seed()
})

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  // Current Chrome returns a Promise from window.scrollTo. An effect that returned it crashed the review screen on
  // the way out ("l is not a function") right after every approval: run with that behaviour on.
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ['--enable-blink-features=ProgrammaticScrollPromise'],
  },
})

test('a supervisor approves a pass from home and lands on an empty queue', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  writePass('submitted')
  await loginStaff(page, 'supervisor')
  expect(await page.evaluate(() => Object.prototype.toString.call(window.scrollTo({ top: 0 })))).toBe('[object Promise]')

  await expect(page.getByText('1 pass is waiting for you')).toBeVisible()
  await page.getByRole('link', { name: 'Review now' }).click()
  await expect(page.getByRole('heading', { name: PLATE })).toBeVisible()
  await page.getByRole('button', { name: /^approve$/i }).click()

  await expect(page).toHaveURL(/\/supervisor\/approvals$/)
  await expect(page.getByText('All caught up')).toBeVisible()
  await expect(page.getByText(/something went wrong|unexpected application error/i)).toHaveCount(0)
  expect(errors).toEqual([])

  await page.getByRole('tab', { name: 'Approved' }).click()
  await expect(page.getByRole('list', { name: 'Approved passes' }).getByText(PLATE)).toBeVisible()
})
