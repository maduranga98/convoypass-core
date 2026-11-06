import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run against the Firebase emulators (Auth, Firestore, Functions, Storage) and the Vite dev server:
 *
 *   npm run test:e2e
 *
 * Locally with a Chromium that is not Playwright's own build, set PW_CHROMIUM_PATH to its executable.
 */
const PORT = 5173
export const EMULATOR_PROJECT = 'demo-conveypass-e2e'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/support/globalSetup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      // A fake camera feed: the capture and QR scanner screens run without hardware.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    // Headless Chromium denies notifications unless granted: tests that need the blocked state override this.
    permissions: ['camera', 'geolocation', 'notifications'],
  },
  webServer: [
    {
      // The production build served with the real hosting headers (CSP report-only included): see e2e/csp.spec.ts.
      command: 'npm run build:e2e && node e2e/support/cspServer.mjs',
      url: 'http://127.0.0.1:5174/login',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_USE_EMULATORS: 'true',
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
      VITE_FIREBASE_PROJECT_ID: EMULATOR_PROJECT,
      VITE_FIREBASE_STORAGE_BUCKET: `${EMULATOR_PROJECT}.appspot.com`,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
      VITE_FIREBASE_APP_ID: '1:1:web:e2e',
      VITE_FUNCTIONS_REGION: 'asia-south1',
      VITE_APP_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
    },
  ],
})
