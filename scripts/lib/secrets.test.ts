import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { assertPassword, generatePassword, readPasswordFromStdin, SecretError } from './secrets.ts'

describe('generatePassword', () => {
  it('is 20 characters from an unambiguous alphabet with upper, lower and a digit, and differs between calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const p = generatePassword()
      seen.add(p)
      expect(p).toHaveLength(20)
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/) // no 0 O 1 l I
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[2-9]/)
    }
    expect(seen.size).toBe(50)
  })
})

describe('assertPassword', () => {
  it('rejects short, email-equal and common passwords', () => {
    expect(() => assertPassword('short', 'a@b.co', 14)).toThrow(/at least 14/)
    expect(() => assertPassword('A@B.co-padding-long', 'a@b.co-padding-long', 14)).toThrow(/email/)
    expect(() => assertPassword('password', 'a@b.co', 1)).toThrow(/common/)
    expect(() => assertPassword('Correct-Horse-Battery', 'a@b.co', 14)).not.toThrow()
  })
})

describe('readPasswordFromStdin', () => {
  it('reads everything and drops one trailing newline', async () => {
    expect(await readPasswordFromStdin(Readable.from(['Corr', 'ect-pass\n']))).toBe('Correct-pass')
    expect(await readPasswordFromStdin(Readable.from(['x y\r\n']))).toBe('x y')
  })
  it('refuses an interactive terminal', async () => {
    const tty = Object.assign(Readable.from([]), { isTTY: true })
    await expect(readPasswordFromStdin(tty)).rejects.toBeInstanceOf(SecretError)
  })
})
