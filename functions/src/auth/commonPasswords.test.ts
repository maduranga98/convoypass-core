import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMON_PASSWORDS, isCommonPassword } from './commonPasswords.js'

describe('common passwords', () => {
  it('is a list of 200 unique lowercase entries', () => {
    expect(COMMON_PASSWORDS).toHaveLength(200)
    expect(new Set(COMMON_PASSWORDS).size).toBe(200)
    expect(COMMON_PASSWORDS.every((p) => p === p.toLowerCase() && p.length > 0)).toBe(true)
  })
  it('matches case-insensitively and ignores surrounding spaces', () => {
    expect(isCommonPassword('Password123')).toBe(true)
    expect(isCommonPassword(' QWERTYUIOP ')).toBe(true)
    expect(isCommonPassword('Correct-horse-battery-9')).toBe(false)
  })
  it('is identical to the web copy (src/lib/commonPasswords.ts)', () => {
    const web = readFileSync(join(__dirname, '../../../src/lib/commonPasswords.ts'), 'utf8')
    const list = (src: string) => [...src.matchAll(/'([^']+)',/g)].map((m) => m[1])
    expect(list(web)).toEqual([...COMMON_PASSWORDS])
  })
})
