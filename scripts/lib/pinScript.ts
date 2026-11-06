// PIN helpers for operator scripts (Module 12): which pepper to hash with, and writing `pinIndex` safely.
// A PIN is printed by the script that issued it, or written to the migration CSV, and NOWHERE else.
import { readFileSync } from 'node:fs'
import { assertPepper, DEV_PIN_PEPPER, PepperMissingError } from '../../functions/src/pin.ts'
import type { Target } from './env.ts'

/** `KEY=value` lines of `functions/.secret.local` (the Functions emulator's secrets file). */
export function readSecretLocal(path = 'functions/.secret.local'): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1] as string, (m[2] as string).replace(/^['"]|['"]$/g, '')]),
    )
  } catch {
    return {}
  }
}

export const PEPPER_HELP = [
  'PIN_PEPPER is required (the same value the deployed functions use). Read it from Secret Manager into this one command:',
  '',
  '  PIN_PEPPER="$(gcloud secrets versions access latest --secret=PIN_PEPPER --project <project-id>)" npm run …',
  '',
  'It is never a command-line argument and never written anywhere by this script.',
]

/**
 * The emulator uses `functions/.secret.local` (PIN_PEPPER=…), else the fixed development pepper the emulator functions
 * fall back to. Staging and production need PIN_PEPPER in the environment, exactly as the deployed secret.
 */
export function scriptPepper(target: Target, env: NodeJS.ProcessEnv = process.env, secretLocal = readSecretLocal): string {
  if (target.env === 'emulator') return assertPepper(secretLocal().PIN_PEPPER || DEV_PIN_PEPPER)
  try {
    return assertPepper(env.PIN_PEPPER)
  } catch (e) {
    if (e instanceof PepperMissingError) throw new Error(PEPPER_HELP.join('\n'), { cause: e })
    throw e
  }
}
