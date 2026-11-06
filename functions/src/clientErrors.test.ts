import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reportClientError, scrubRoute, scrubText } from './clientErrors.js'
import { setLogSink } from './logger.js'
import { caller, makeWorld, rejects, type World } from './test-utils.js'

const lines: { message: string; fields: Record<string, unknown> }[] = []
let restore: () => void
let w: World
beforeEach(() => {
  w = makeWorld()
  restore = setLogSink({
    info: (message, fields) => lines.push({ message, fields }),
    warn: (message, fields) => lines.push({ message, fields }),
    error: (message, fields) => lines.push({ message, fields }),
  })
})
afterEach(() => {
  restore()
  lines.length = 0
})

describe('scrubText / scrubRoute', () => {
  it('removes emails, phone numbers, tokens, uuids, vehicle ids and url query strings', () => {
    const dirty =
      'Failed for dan@example.com phone 0771234567 and +94 77 123 4567 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig id 11111111-1111-4111-8111-111111111111 veh_abcdefghij at https://app.example.com/assets/index-abc.js?token=SECRET#frag key ' + 'k'.repeat(50)
    const clean = scrubText(dirty, 1000)
    for (const bad of ['dan@example.com', '0771234567', '4567', 'eyJhbGci', '11111111-1111', 'veh_abcdefghij', 'SECRET', 'app.example.com', 'kkkkkkkkkk']) {
      expect(clean).not.toContain(bad)
    }
    expect(clean).toContain('/assets/index-abc.js')
  })
  it('truncates', () => expect(scrubText('x '.repeat(500), 40)).toHaveLength(40))
  it('keeps only the path of a route and replaces ids', () => {
    expect(scrubRoute('/supervisor/approvals/veh_abcdefghij_20260310?x=1#y')).toBe('/supervisor/approvals/:id')
    expect(scrubRoute('/v/veh_abcdefghij')).toBe('/v/:id')
    expect(scrubRoute('/admin/audit?actor=u1&from=2026-01-01')).toBe('/admin/audit')
  })
})

describe('reportClientError', () => {
  it('writes one structured log line with uid, tenant, source and scrubbed text; nothing else from the payload', async () => {
    const c = caller('drv1', 'driver', 'C1')
    await reportClientError(w.deps, c, {
      message: 'TypeError: x is undefined for 0771234567', stack: 'at Foo (https://app.example.com/assets/a.js:1:2)', route: '/v/veh_abcdefghij', source: 'boundary', appVersion: '1.2.3',
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toBe('reportClientError')
    expect(lines[0]?.fields).toMatchObject({ fn: 'reportClientError', uid: 'drv1', tenantId: 'T1', source: 'boundary', route: '/v/:id', role: 'driver', appVersion: '1.2.3' })
    const text = JSON.stringify(lines)
    expect(text).not.toContain('0771234567')
    expect(text).not.toContain('app.example.com')
    expect(String(lines[0]?.fields.stack)).toContain('/assets/a.js:1:2')
  })
  it('truncates long messages and stacks', async () => {
    await reportClientError(w.deps, caller('drv1', 'driver', 'C1'), { message: 'm'.repeat(2000), stack: 'ab '.repeat(3000), source: 'window' })
    expect(String(lines[0]?.fields.message).length).toBeLessThanOrEqual(301)
    expect(String(lines[0]?.fields.stack).length).toBeLessThanOrEqual(1501)
  })
  it('rejects an invalid payload', async () => {
    await rejects(reportClientError(w.deps, caller('drv1', 'driver', 'C1'), { message: 'x', source: 'hack' }), 'invalid-argument', 'invalid-input')
    await rejects(reportClientError(w.deps, caller('drv1', 'driver', 'C1'), { source: 'window' }), 'invalid-argument', 'invalid-input')
  })
})
