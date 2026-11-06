/** Same shape as functions/src/ids.ts: `veh_` + 10 chars [a-z0-9]. */
export const VEHICLE_ID_RE = /^veh_[a-z0-9]{10}$/

/**
 * The vehicle id in a scanned QR, or null when it is not one of ours. Accepts `${baseUrl}/v/{id}` (a trailing slash,
 * a query string or a hash are tolerated) or a bare id. A URL on any other origin or path prefix is refused, so a
 * look-alike code on another site never opens a gate view.
 */
export function parseVehicleQr(text: string, baseUrl: string | null): string | null {
  const raw = text.trim()
  if (VEHICLE_ID_RE.test(raw)) return raw
  if (!baseUrl) return null
  let url: URL
  let base: URL
  try {
    url = new URL(raw)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (url.origin !== base.origin) return null
  const prefix = base.pathname.replace(/\/+$/, '')
  const match = url.pathname.match(/^(.*)\/v\/([^/]+)\/?$/)
  if (!match || match[1] !== prefix) return null
  const id = match[2] ?? ''
  return VEHICLE_ID_RE.test(id) ? id : null
}
