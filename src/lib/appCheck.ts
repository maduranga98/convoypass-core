import type { FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

declare global {
  // Read by the App Check SDK before it initialises: `true` prints a new debug token, a string reuses a registered one.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined
}

/**
 * App Check with reCAPTCHA Enterprise (VITE_APP_CHECK_SITE_KEY). Without a key, or against the emulators, nothing
 * is initialised, so local work and the first monitoring-mode rollout need no setup. For local and CI use, set
 * VITE_APP_CHECK_DEBUG_TOKEN ("true" prints a token to register in the console, or paste a registered one).
 * Never set a debug token in a production build.
 */
export function initAppCheck(app: FirebaseApp): void {
  const siteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY
  if (!siteKey || import.meta.env.VITE_USE_EMULATORS === 'true') return
  const debug = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN
  if (debug && !import.meta.env.PROD) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug === 'true' ? true : debug
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })
}
