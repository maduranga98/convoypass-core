import { expect, type Page } from '@playwright/test'
import { DRIVER_PIN, PASSWORD, SECURITY_PIN, STAFF } from './emulator.ts'

/** Office staff use the email form at /login/staff; `security` signs in with its PIN (Module 12). */
export async function loginStaff(page: Page, role: keyof typeof STAFF): Promise<void> {
  if (role === 'security') return loginPin(page, SECURITY_PIN, /\/security/)
  await page.goto('/login/staff')
  await page.getByLabel('Email').fill(STAFF[role].email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/${String(role)}`))
}

/** Types the PIN on the on-screen keypad; the 8th digit signs in by itself. */
export async function loginPin(page: Page, pin: string, home: RegExp, from = '/login'): Promise<void> {
  await page.goto(from)
  const keypad = page.getByRole('group', { name: 'Number keys' })
  for (const d of pin) await keypad.getByRole('button', { name: d, exact: true }).click()
  await expect(page).toHaveURL(home)
}

export const loginDriver = (page: Page): Promise<void> => loginPin(page, DRIVER_PIN, /\/driver/)

export const bellBadge = (page: Page) => page.getByTestId('bell-badge')
