import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  memoryLruGarbageCollector,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { initAppCheck } from './appCheck'

/** Must match FUNCTIONS_REGION in functions/.env */
export const FUNCTIONS_REGION: string = import.meta.env.VITE_FUNCTIONS_REGION || 'asia-south1'

/** Build-time settings the app cannot run without. Empty when everything is present (see `ConfigGate`). */
export const missingFirebaseConfig: string[] = (
  [
    ['VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY],
    ['VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN],
    ['VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID],
    ['VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID],
  ] as const
)
  .filter(([, value]) => !value)
  .map(([name]) => name)

export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

// Before any other service is used, so every request carries a token once App Check is configured.
initAppCheck(app)

// Email/password only: no popupRedirectResolver, so the SDK never loads apis.google.com/js/api.js (gapi) or the auth
// iframe, which the CSP does not (and should not) allow.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
// In-memory cache with LRU eviction: documents read earlier in the session (the gate's vehicles, drivers and today's
// passes) stay available while the connection drops, but nothing is written to disk, so one account's data never
// outlives the page for the next person on a shared phone.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector({ cacheSizeBytes: 40 * 1024 * 1024 }) }),
})
export const functions = getFunctions(app, FUNCTIONS_REGION)

// Ports match firebase.json.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
