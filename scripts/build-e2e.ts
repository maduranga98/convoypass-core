/**
 * A production build pointed at the emulators, for the CSP e2e run (it serves this build with the real hosting headers).
 *   tsx scripts/build-e2e.ts   ->  dist-csp/
 */
import { build } from 'vite'

Object.assign(process.env, {
  VITE_USE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'demo-conveypass-e2e',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-conveypass-e2e.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:e2e',
  VITE_FUNCTIONS_REGION: 'asia-south1',
  VITE_APP_BASE_URL: 'http://127.0.0.1:5174',
})
await build({ logLevel: 'warn', build: { outDir: 'dist-csp', emptyOutDir: true } })
