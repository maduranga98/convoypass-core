/** Where QR codes point. Pure helpers; the env is read in one place (`getAppBase`). */

export interface AppBase {
  /** Origin plus optional path prefix, no trailing slash. */
  url: string
  hostname: string
  /** True when labels printed with this base would be unusable in production. */
  isDevLink: boolean
}

const isPrivateHost = (h: string): boolean =>
  h === 'localhost' ||
  h.endsWith('.localhost') ||
  h.endsWith('.local') ||
  h === '[::1]' ||
  /^127\./.test(h) ||
  /^10\./.test(h) ||
  /^192\.168\./.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(h)

/**
 * Parses VITE_APP_BASE_URL. `productionHosts` (VITE_PRODUCTION_HOST, comma separated) pins the real domain(s);
 * when empty, any https host that is not localhost/private counts as production.
 */
export function parseAppBase(raw: string | undefined, productionHosts = ''): AppBase | null {
  if (!raw?.trim()) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const hosts = productionHosts
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const hostname = u.hostname.toLowerCase()
  const isDevLink =
    isPrivateHost(hostname) || (hosts.length > 0 ? !hosts.includes(hostname) : u.protocol !== 'https:')
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, hostname, isDevLink }
}

/** The only thing a vehicle QR encodes: `${base}/v/${vehicleId}`. */
export const vehicleUrl = (baseUrl: string, vehicleId: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/v/${encodeURIComponent(vehicleId)}`

/** Human-typable form of the URL: no scheme. */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, '')

export const appBase: AppBase | null = parseAppBase(
  import.meta.env.VITE_APP_BASE_URL,
  import.meta.env.VITE_PRODUCTION_HOST,
)
