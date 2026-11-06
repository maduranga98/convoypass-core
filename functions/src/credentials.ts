// Mirrors src/lib/credentials.ts in the web app (functions deploy from this folder only).
// Keep both copies, and their tests, in sync.
import { z } from 'zod'

/** `07XXXXXXXX` or `+947XXXXXXXX` -> `947XXXXXXXX`. Anything else -> null. Contact numbers only (Module 12): never a login. */
export function normalisePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-()]/g, '')
  let national: string | null = null
  if (/^07\d{8}$/.test(compact)) national = compact.slice(1)
  else if (/^\+947\d{8}$/.test(compact)) national = compact.slice(3)
  return national ? `94${national}` : null
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export const isValidPassword = (v: string): boolean =>
  v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH

export const staffPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
