// Temporary passwords the platform super admin hands to a workspace admin (Module 10). Shown once in the response, never
// stored or logged. 16 characters from an alphabet without look-alikes (no 0 O 1 l I), at least one upper, lower and digit.
// Free of firebase imports.
import { randomInt } from 'node:crypto'

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
export const TEMP_PASSWORD_LENGTH = 16
export const TEMP_PASSWORD_PATTERN = /^[A-HJ-NP-Za-km-z2-9]{16}$/

export function generateTempPassword(pick: (max: number) => number = randomInt): string {
  const from = (set: string) => set[pick(set.length)] as string
  const all = UPPER + LOWER + DIGIT
  const chars = [from(UPPER), from(LOWER), from(DIGIT), ...Array.from({ length: TEMP_PASSWORD_LENGTH - 3 }, () => from(all))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join('')
}
