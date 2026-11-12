import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/visitorLogic'
import * as web from './visitorLogic'

describe('visitor logic', () => {
  it('exports the same names and behaves identically in the web and functions copies', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(fn).sort())
    expect(web.PASS_CODE_ALPHABET).toBe(fn.PASS_CODE_ALPHABET)
    expect(web.STARTER_MONTHLY_CAP).toBe(fn.STARTER_MONTHLY_CAP)
    expect(web.VISITOR_PASS_STATUSES).toEqual(fn.VISITOR_PASS_STATUSES)
    for (const plan of [undefined, null, 'starter', 'growth', 'compliance', 'x'] as const) expect(web.planOf({ plan })).toBe(fn.planOf({ plan }))
    for (const code of ['abcd-efgh', 'ABCDEFG0', ' abcdefgh', 'x']) expect(web.normalisePassCode(code)).toBe(fn.normalisePassCode(code))
    const base = 'https://app.example.com/ops'
    for (const text of [`${base}/vp/ABCDEFGH`, 'ABCDEFGH', 'https://evil.test/vp/ABCDEFGH', `${base}/v/veh_aaaaaaaaaa`]) expect(web.parseVisitorQr(text, base)).toBe(fn.parseVisitorQr(text, base))
    const now = 1_700_000_000_000
    for (const input of [{}, { validFrom: '2023-11-20', validUntil: '2023-11-22' }, { validFrom: '2023-11-01' }, { validUntil: '2024-01-31' }]) {
      for (const days of [1, 3]) expect(web.validityWindow('Asia/Colombo', now, input, days)).toEqual(fn.validityWindow('Asia/Colombo', now, input, days))
    }
    const pass = { status: 'active' as const, validFrom: 1000, validUntil: 2000, checkInAt: 1500, maxDwellMinutes: 60 }
    for (const t of [500, 1000, 2000, 2001]) {
      expect(web.entryCheck(pass, t)).toBe(fn.entryCheck(pass, t))
      expect(web.effectiveStatus(pass, t)).toBe(fn.effectiveStatus(pass, t))
    }
    expect(web.isOverstay({ ...pass, status: 'checked_in' }, 1500 + 61 * 60_000)).toBe(fn.isOverstay({ ...pass, status: 'checked_in' }, 1500 + 61 * 60_000))
    expect(web.visitorSettingsOf({ visitorSettings: { maxDwellMinutes: 90 } })).toEqual(fn.visitorSettingsOf({ visitorSettings: { maxDwellMinutes: 90 } }))
    expect(web.idKeyOf('19-85 123v')).toBe(fn.idKeyOf('19-85 123v'))
  })
})
