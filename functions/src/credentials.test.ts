import { describe, expect, it } from 'vitest'
import { isValidPassword, normalisePhone } from './credentials.js'

describe('normalisePhone', () => {
  it.each([
    ['0771234567', '94771234567'],
    ['077 123 4567', '94771234567'],
    ['077-123-4567', '94771234567'],
    ['+94771234567', '94771234567'],
    ['+94 77 123 4567', '94771234567'],
  ])('accepts %s', (input, expected) => expect(normalisePhone(input)).toBe(expected))

  it.each(['', '12345', '0111234567', '771234567', '94771234567', '+9477123456', '+947712345678', '0771234abc', '+44771234567', '00771234567'])(
    'rejects %s',
    (input) => expect(normalisePhone(input)).toBeNull(),
  )
})

describe('credential validators', () => {
  it('validates passwords', () => {
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('a'.repeat(129))).toBe(false)
  })
})
