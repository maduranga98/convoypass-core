import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleCspReport, parseCspReports, reduceUri, type MinimalResponse } from './cspReport.js'
import { setLogSink } from './logger.js'

const lines: Record<string, unknown>[] = []
let restore: () => void
beforeEach(() => {
  restore = setLogSink({ info: () => undefined, error: () => undefined, warn: (_m, f) => void lines.push(f) })
})
afterEach(() => {
  restore()
  lines.length = 0
})

const res = () => {
  const r = { code: 0, status(c: number) { r.code = c; return r as unknown as MinimalResponse }, send() { /* ok */ } }
  return r as typeof r & MinimalResponse
}

describe('csp report endpoint', () => {
  it('reduces blocked uris to host and path, keeping keywords', () => {
    expect(reduceUri('https://cdn.example.com/lib.js?token=SECRET#x')).toBe('cdn.example.com/lib.js')
    expect(reduceUri('inline')).toBe('inline')
    expect(reduceUri('nonsense')).toBe('unknown')
    expect(reduceUri(undefined)).toBe('unknown')
  })
  it('parses the classic and the Reporting API formats', () => {
    const classic = { 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?a=1', 'document-uri': 'https://app.example.com/v/veh_abc?x=1', disposition: 'report' } }
    expect(parseCspReports(classic)).toEqual([{ directive: 'script-src', blocked: 'evil.example/x.js', page: '/v/veh_abc', disposition: 'report' }])
    const api = [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'data', documentURL: 'https://app.example.com/driver', disposition: 'report' } }, { type: 'deprecation', body: {} }]
    expect(parseCspReports(api)).toEqual([{ directive: 'img-src', blocked: 'data', page: '/driver', disposition: 'report' }])
    expect(parseCspReports('garbage')).toEqual([])
  })
  it('logs one line per violation without query strings and answers 204; rejects other methods and big bodies', () => {
    const ok = res()
    handleCspReport({ method: 'POST', headers: {}, body: { 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://x.example/a?secret=1', 'document-uri': 'https://app.example.com/security?z=1' } } }, ok)
    expect(ok.code).toBe(204)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ fn: 'cspReport', directive: 'connect-src', blocked: 'x.example/a', page: '/security' })
    expect(JSON.stringify(lines)).not.toContain('secret')
    // application/csp-report arrives unparsed: the raw body is read.
    const raw = res()
    handleCspReport({ method: 'POST', headers: {}, body: {}, rawBody: Buffer.from(JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data' } })) }, raw)
    expect(raw.code).toBe(204)
    expect(lines).toHaveLength(2)
    const get = res()
    handleCspReport({ method: 'GET', headers: {}, body: {} }, get)
    expect(get.code).toBe(405)
    const big = res()
    handleCspReport({ method: 'POST', headers: { 'content-length': '999999' }, body: {} }, big)
    expect(big.code).toBe(413)
    expect(lines).toHaveLength(2)
  })
})
