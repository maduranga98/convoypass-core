import { describe, expect, it } from 'vitest'
import { parseAppBase, shortUrl, vehicleUrl } from './appUrl'

describe('vehicleUrl', () => {
  it('builds ${base}/v/${id} and ignores trailing slashes', () => {
    expect(vehicleUrl('https://app.example.com', 'veh_abc1234567')).toBe('https://app.example.com/v/veh_abc1234567')
    expect(vehicleUrl('https://app.example.com/', 'veh_abc1234567')).toBe('https://app.example.com/v/veh_abc1234567')
  })
  it('contains nothing but the id', () => {
    expect(vehicleUrl('https://x.test', 'veh_abc1234567')).not.toMatch(/\?|#/)
  })
  it('has a typable short form', () => {
    expect(shortUrl('https://x.test/v/veh_abc1234567')).toBe('x.test/v/veh_abc1234567')
  })
})

describe('parseAppBase', () => {
  it('requires a valid http(s) URL', () => {
    expect(parseAppBase(undefined)).toBeNull()
    expect(parseAppBase('')).toBeNull()
    expect(parseAppBase('not a url')).toBeNull()
    expect(parseAppBase('ftp://x.test')).toBeNull()
  })
  it('flags localhost and private hosts as dev links', () => {
    for (const u of ['http://localhost:5173', 'https://localhost', 'http://127.0.0.1:5173', 'http://192.168.1.4:5173', 'http://my.local']) {
      expect(parseAppBase(u)?.isDevLink).toBe(true)
    }
  })
  it('accepts an https public host as production when no production host is pinned', () => {
    expect(parseAppBase('https://convoypass.example.com/')).toMatchObject({ url: 'https://convoypass.example.com', isDevLink: false })
    expect(parseAppBase('http://convoypass.example.com')?.isDevLink).toBe(true)
  })
  it('flags any host other than the pinned production domain', () => {
    expect(parseAppBase('https://prod.example.com', 'prod.example.com')?.isDevLink).toBe(false)
    expect(parseAppBase('https://staging.example.com', 'prod.example.com')?.isDevLink).toBe(true)
    expect(parseAppBase('https://b.example.com', 'a.example.com, b.example.com')?.isDevLink).toBe(false)
  })
})
