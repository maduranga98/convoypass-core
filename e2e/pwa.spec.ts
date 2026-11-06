import { expect, test } from '@playwright/test'

// The production build, served like Firebase Hosting serves it (e2e/support/cspServer.mjs).
test.use({ baseURL: 'http://127.0.0.1:5174' })

test('the production build is installable (manifest, icons, service worker) and its shell opens offline', async ({ page, context }) => {
  await page.goto('/login')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  // The worker takes control after its first activation: reload once so the next load is served by it.
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))

  const cdp = await context.newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  // Playwright's browser contexts are incognito, which Chrome lists as an error of its own: ignore that one only.
  expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito'), 'Chrome would not offer to install the app').toEqual([])
  const { data, errors } = await cdp.send('Page.getAppManifest')
  expect(errors.filter((e) => e.critical)).toEqual([])
  const manifest = JSON.parse(data ?? '{}') as { name: string; display: string; start_url: string; icons: { sizes: string; purpose?: string }[] }
  expect(manifest).toMatchObject({ name: 'ConvoyPass', display: 'standalone' })
  expect(manifest.icons.map((i) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`)).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))

  // Offline: the precached app shell still renders the PIN sign-in screen.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Number keys' })).toBeVisible()
  await context.setOffline(false)
})

test('the manifest, worker and shell are never cached by the browser, hashed assets for a year', async ({ page }) => {
  const get = async (path: string) => (await page.request.get(path)).headers()['cache-control']
  expect(await get('/sw.js')).toBe('no-cache')
  expect(await get('/manifest.webmanifest')).toBe('no-cache')
  expect(await get('/login')).toBe('no-cache')
  const html = await (await page.request.get('/login')).text()
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0]
  expect(asset).toBeTruthy()
  expect(await get(asset as string)).toBe('public, max-age=31536000, immutable')
})
