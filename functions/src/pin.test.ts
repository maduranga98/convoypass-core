import { describe, expect, it } from 'vitest'
import { assertPepper, DEV_PIN_PEPPER, formatPin, generatePin, identifierKey, isTrivialPin, normalisePin, PepperMissingError, pinKey } from './pin.js'
import { TEST_PEPPER } from './test-utils.js'

describe('isTrivialPin', () => {
  it.each([
    '00000000', '77777777', // one digit
    '12345678', '87654321', '01234567', '98765432', '90123499', '55432100', // runs of 4+
    '12121212', '90909090', // ^(\d\d)\1{3}$
    '48294829', '10001000', // ^(\d{4})\1$
    '11223344', '20252025', '14725836', // deny list
    '40000071', // four of one digit in a row
    '1234567', '123456789', 'abcdefgh', // not 8 digits
  ])('flags %s', (pin) => expect(isTrivialPin(pin)).toBe(true))

  it.each(['48291736', '59302847', '70413958', '13572468', '90817263'])('accepts %s', (pin) => expect(isTrivialPin(pin)).toBe(false))
})

describe('generatePin', () => {
  it('always 8 digits and never trivial (property test over many generations)', () => {
    for (let i = 0; i < 20_000; i++) {
      const pin = generatePin()
      expect(pin).toMatch(/^\d{8}$/)
      expect(isTrivialPin(pin)).toBe(false)
    }
  })
  it('pads short numbers and skips trivial draws', () => {
    const draws = [12345678, 1234, 48291736]
    expect(generatePin(() => draws.shift() as number)).toBe('48291736')
    expect(generatePin(() => 4829173)).toBe('04829173')
  })
})

describe('normalisePin / formatPin', () => {
  it('strips spaces and dashes, refuses everything else', () => {
    expect(normalisePin('4829 1736')).toBe('48291736')
    expect(normalisePin(' 4829-1736 ')).toBe('48291736')
    for (const bad of ['4829173', '482917361', '4829 173a', '', null, 48291736, '٤٨٢٩١٧٣٦', 'x'.repeat(40)]) {
      expect(normalisePin(bad)).toBeNull()
    }
  })
  it('formats as 1234 5678', () => expect(formatPin('48291736')).toBe('4829 1736'))
})

describe('keys', () => {
  it('pinKey is a stable HMAC-SHA256 hex that depends on the pepper', () => {
    const a = pinKey('48291736', TEST_PEPPER)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(pinKey('48291736', TEST_PEPPER)).toBe(a)
    expect(pinKey('48291736', DEV_PIN_PEPPER)).not.toBe(a)
    expect(a).not.toContain('48291736')
  })
  it('identifier keys separate IPs from devices', () => {
    expect(identifierKey('ip', 'x', TEST_PEPPER)).not.toBe(identifierKey('dev', 'x', TEST_PEPPER))
    expect(identifierKey('ip', '10.0.0.1', TEST_PEPPER)).toMatch(/^[0-9a-f]{32}$/)
  })
  it('refuses a missing or short pepper', () => {
    expect(() => assertPepper(undefined)).toThrow(PepperMissingError)
    expect(() => assertPepper('short')).toThrow(PepperMissingError)
    expect(() => pinKey('48291736', '')).toThrow(PepperMissingError)
    expect(assertPepper(TEST_PEPPER)).toBe(TEST_PEPPER)
  })
})
