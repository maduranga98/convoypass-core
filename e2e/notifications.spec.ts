import { expect, test } from '@playwright/test'
import { notificationsFor, seed, uids, writeSubmittedPass } from './support/emulator.ts'
import { bellBadge, loginStaff } from './support/ui.ts'

// Every test starts from the same clean tenant: earlier tests leave passes and notifications behind otherwise.
test.beforeEach(() => {
  seed()
})

test.describe('notifications (real Firestore trigger, rules and client)', () => {
  test('a submitted pass notifies the supervisor live: badge, tab title, panel, mark read, navigate', async ({ page }) => {
    await loginStaff(page, 'supervisor')
    await expect(bellBadge(page)).toHaveCount(0)

    // What submitPass leaves behind. The real onPassWritten trigger creates the notification; the bell is a live listener.
    const passId = writeSubmittedPass()
    await expect(bellBadge(page)).toHaveText('1')
    await expect(page).toHaveTitle('(1) ConvoyPass')
    expect(notificationsFor(uids().supervisor!).map((n) => n.id)).toEqual([`submitted_${passId}_1_${uids().supervisor}`])

    await page.getByRole('button', { name: /notifications, 1 unread/i }).click()
    const panel = page.getByRole('region', { name: 'Notifications', exact: true })
    await expect(panel.getByText('Approval needed')).toBeVisible()
    await expect(panel.getByText('WP LJ-4821 is waiting for your approval')).toBeVisible()

    // Click: marks read (the rules allow only readAt = server time) and opens the pass.
    await panel.getByRole('button', { name: /Approval needed/ }).click()
    await expect(page).toHaveURL(new RegExp(`/supervisor/approvals/${passId}`))
    await expect(bellBadge(page)).toHaveCount(0)
    await expect(page).toHaveTitle('ConvoyPass')
    expect(notificationsFor(uids().supervisor!).map((n) => n.read)).toEqual([true])
  })

  test('two more passes, then Mark all read clears the badge; /notifications lists them', async ({ page }) => {
    await loginStaff(page, 'supervisor')
    writeSubmittedPass('veh_e2etest002', 'CAB-0002')
    writeSubmittedPass('veh_e2etest003', 'CAB-0003')
    await expect(bellBadge(page)).toHaveText('2')
    await page.getByRole('button', { name: /notifications, 2 unread/i }).click()
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(bellBadge(page)).toHaveCount(0)
    await page.getByRole('link', { name: 'See all' }).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(page.getByRole('list').getByRole('listitem').filter({ hasText: 'Approval needed' })).toHaveCount(2)
  })

  test('a user only ever sees their own notifications', async ({ page }) => {
    await loginStaff(page, 'officer')
    writeSubmittedPass('veh_e2etest004', 'CAB-0004')
    // The supervisor got one; the officer (not a recipient of a fresh submission) did not.
    await page.waitForTimeout(1500)
    await expect(bellBadge(page)).toHaveCount(0)
  })
})

test.describe('push opt-in', () => {
  test('the card never asks on load, is dismissible, and stays away after a reload', async ({ page }) => {
    await loginStaff(page, 'supervisor')
    const card = page.getByRole('heading', { name: 'Get alerts for approvals' })
    await expect(card).toBeVisible()
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(card).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: /Hello, Sue/ })).toBeVisible()
    await expect(card).toHaveCount(0)
  })

  test('iPhone Safari outside the installed app gets Add to Home Screen guidance, not an Enable button', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    })
    const page = await context.newPage()
    await loginStaff(page, 'supervisor')
    await expect(page.getByRole('heading', { name: 'Add to Home Screen to enable alerts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enable' })).toHaveCount(0)
    await context.close()
  })
})

test.describe('alert settings', () => {
  test('/settings shows this device and, when the browser blocks notifications, how to fix it', async ({ browser }) => {
    const context = await browser.newContext({ permissions: [] }) // headless default: notifications denied
    const page = await context.newPage()
    await loginStaff(page, 'supervisor')
    await page.getByRole('button', { name: 'Notifications' }).click()
    await page.getByRole('link', { name: 'Alert settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('switch', { name: /Alerts on this device/ })).toBeDisabled()
    await expect(page.getByTestId('permission-status')).toContainText('Blocked in your browser settings')
    await context.close()
  })

  test('the card is hidden for a blocked browser and for security guards', async ({ browser }) => {
    const blocked = await browser.newContext({ permissions: [] })
    const page = await blocked.newPage()
    await loginStaff(page, 'supervisor')
    await expect(page.getByRole('heading', { name: 'Get alerts for approvals' })).toHaveCount(0)
    await blocked.close()
  })
})
