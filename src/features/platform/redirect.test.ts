import { describe, expect, it } from 'vitest'
import { changePasswordUrl, platformLoginUrl, safePlatformPath } from './redirect'

describe('safePlatformPath', () => {
  it('keeps paths inside /platform, with their query and hash', () => {
    expect(safePlatformPath('/platform')).toBe('/platform')
    expect(safePlatformPath('/platform/workspaces/ten_abc?x=1#top')).toBe('/platform/workspaces/ten_abc?x=1#top')
    expect(safePlatformPath('/platform/invites')).toBe('/platform/invites')
  })
  it('ignores everything outside /platform: workspace pages, look-alikes, other sites, tricks', () => {
    for (const bad of [
      '/admin/dashboard', '/login', '/', '/platformx', '/platform-evil/x', '//evil.com', '/\\evil.com', 'https://evil.com/platform',
      'javascript:alert(1)', '/platform/../admin', '/platform/login', '/platform/change-password', '', null, undefined, '/platform\n/x',
    ]) {
      expect(safePlatformPath(bad), String(bad)).toBeNull()
    }
  })
  it('builds the sign-in and change-password URLs from safe values only', () => {
    expect(platformLoginUrl('/platform/invites', 'reauth')).toBe('/platform/login?from=%2Fplatform%2Finvites&reason=reauth')
    expect(platformLoginUrl('/admin/x', 'idle')).toBe('/platform/login?reason=idle')
    expect(platformLoginUrl()).toBe('/platform/login')
    expect(changePasswordUrl('/platform/workspaces')).toBe('/platform/change-password?next=%2Fplatform%2Fworkspaces')
    expect(changePasswordUrl('https://evil.com')).toBe('/platform/change-password')
  })
})
