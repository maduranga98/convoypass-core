// Mirrors functions/src/credentials.ts (functions deploy from their own folder). Keep both copies, and their tests, in sync.
import { z } from '@/lib/zod'

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

/** `94771234567` -> `077 123 4567` for display; no number (an optional contact number, Module 12) -> ''. */
export function formatPhone(normalised: string | null | undefined): string {
  if (!normalised) return ''
  const m = /^94(7\d)(\d{3})(\d{4})$/.exec(normalised)
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : normalised
}

function randomInt(max: number): number {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / max) * max
  do crypto.getRandomValues(buf)
  while ((buf[0] as number) >= limit)
  return (buf[0] as number) % max
}

// No look-alike characters (0/O, 1/l/I).
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generatePassword(length = 12): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('')
}
