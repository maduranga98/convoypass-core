import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enforcingConfig, ENFORCING, REPORT_ONLY } from './enforce-csp.ts'

const source = readFileSync('firebase.json', 'utf8')
type Config = { hosting: { headers: { source: string; headers: { key: string; value: string }[] }[]; rewrites: { source: string }[] } }
const base = JSON.parse(source) as Config
const headersOf = (c: Config, key: string) => c.hosting.headers.flatMap((r) => r.headers).filter((h) => h.key === key)

describe('hosting headers', () => {
  const all = base.hosting.headers.find((r) => r.source === '**')?.headers ?? []
  const value = (key: string) => all.find((h) => h.key === key)?.value

  it('sends the security headers on all routes', () => {
    expect(value('Strict-Transport-Security')).toMatch(/max-age=31536000/)
    expect(value('X-Content-Type-Options')).toBe('nosniff')
    expect(value('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(value('Permissions-Policy')).toBe('camera=(self), geolocation=(self), microphone=()')
    expect(value('X-Frame-Options')).toBe('DENY')
  })
  it('starts with the CSP in report-only mode, never enforcing', () => {
    expect(headersOf(base, REPORT_ONLY)).toHaveLength(1)
    expect(headersOf(base, ENFORCING)).toHaveLength(0)
  })
  it('the policy allows the app, Firebase and reCAPTCHA, data/blob images, and nothing else for scripts', () => {
    const csp = value(REPORT_ONLY) ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src 'self' https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\/(;|$)/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
    expect(csp).toMatch(/img-src [^;]*data: blob:/)
    expect(csp).toMatch(/connect-src [^;]*\*\.googleapis\.com[^;]*\*\.cloudfunctions\.net/)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('report-uri /csp-report')
  })
  it('caches hashed assets for a year and revalidates the shell, the worker and the manifest', () => {
    const rule = (source: string) => base.hosting.headers.find((r) => r.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value
    expect(rule('/assets/**')).toBe('public, max-age=31536000, immutable')
    expect(rule('/@(index.html|sw.js|manifest.webmanifest)')).toBe('no-cache')
    expect(value('Cache-Control')).toBe('no-cache') // every other route, including the SPA fallback
  })
  it('keeps the SPA rewrite last, after the CSP report endpoint', () => {
    expect(base.hosting.rewrites.map((r) => r.source)).toEqual(['/csp-report', '**'])
  })
})

describe('firebase.enforce-csp.json', () => {
  it('is firebase.json with exactly one change: the CSP header is enforcing', () => {
    const enforcing = JSON.parse(enforcingConfig(source)) as Config
    expect(headersOf(enforcing, ENFORCING)).toHaveLength(1)
    expect(headersOf(enforcing, REPORT_ONLY)).toHaveLength(0)
    expect(headersOf(enforcing, ENFORCING)[0]?.value).toBe(headersOf(base, REPORT_ONLY)[0]?.value)
    const swap = (c: Config) => JSON.stringify(c).replace(`"${ENFORCING}"`, `"${REPORT_ONLY}"`)
    expect(swap(enforcing)).toBe(JSON.stringify(base))
  })
  it('the committed file is up to date (run `npm run config:csp`)', () => {
    expect(JSON.parse(readFileSync('firebase.enforce-csp.json', 'utf8'))).toEqual(JSON.parse(enforcingConfig(source)))
  })
  it('refuses to generate when there is no report-only header to promote', () => {
    expect(() => enforcingConfig(JSON.stringify({ hosting: { headers: [] } }))).toThrow(/exactly one/)
  })
})
