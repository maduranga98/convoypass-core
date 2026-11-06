import { defineSecret } from 'firebase-functions/params'
import { IN_EMULATOR } from './config.js'
import { DEV_PIN_PEPPER } from './pin.js'

/**
 * Secret Manager secret (32+ random bytes) under which every PIN, device id and IP is HMAC'd (Module 12). Set it with
 * `firebase functions:secrets:set PIN_PEPPER`; the emulator reads `functions/.secret.local`. Rotating it invalidates every
 * PIN at once (every driver and guard needs a reissued PIN): see docs/ops.md.
 */
export const PIN_PEPPER = defineSecret('PIN_PEPPER')

/**
 * The pepper for the functions that bind the secret (`secrets: [PIN_PEPPER]` exposes it as an environment variable).
 * The emulator falls back to a fixed development pepper when `.secret.local` sets none, so the seeds and the e2e run
 * agree with it; a deployed function never does.
 */
export function readPinPepper(): string | undefined {
  const value = process.env.PIN_PEPPER
  if (value) return value
  return IN_EMULATOR ? DEV_PIN_PEPPER : undefined
}
