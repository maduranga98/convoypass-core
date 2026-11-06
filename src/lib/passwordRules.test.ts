import { describe, expect, it } from 'vitest'
import { COMMON_PASSWORDS } from './commonPasswords'
import { checkStaffPassword, passwordAcceptable } from './passwordRules'

describe('staff password rules', () => {
  it('needs 10+ characters, not the email, not a common password', () => {
    expect(checkStaffPassword('short')).toEqual({ length: false, notEmail: true, notCommon: true })
    expect(checkStaffPassword('ada@acme.test', 'Ada@Acme.test')).toMatchObject({ length: true, notEmail: false })
    expect(checkStaffPassword('Password1234')).toMatchObject({ notCommon: false })
    expect(checkStaffPassword('QWERTYUIOP')).toMatchObject({ length: true, notCommon: false })
    expect(passwordAcceptable(checkStaffPassword('Correct-horse-battery-9', 'ada@acme.test'))).toBe(true)
  })
  it('an empty field only fails the length rule', () => {
    expect(checkStaffPassword('')).toEqual({ length: false, notEmail: true, notCommon: true })
  })
  it('refuses every entry of the deny-list that is long enough', () => {
    for (const p of COMMON_PASSWORDS.filter((x) => x.length >= 10)) expect(passwordAcceptable(checkStaffPassword(p))).toBe(false)
  })
})
