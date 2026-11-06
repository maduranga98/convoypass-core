/**
 * The invite code travels in the URL fragment (`/setup#code=...`): fragments are never sent to a server, never in
 * Referer headers and not in logs. It is read once, removed from the address bar at once, and kept in component
 * memory only: never localStorage, sessionStorage, a cookie or the query string.
 */
const CODE_FORMAT = /^[A-Za-z0-9_-]{43}$/

export const parseCodeFromHash = (hash: string): string | null => {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('code')
  return raw && CODE_FORMAT.test(raw) ? raw : null
}

/** Returns the code (if any) and strips the whole fragment from the address bar. History state is kept intact. */
export function takeCodeFromLocation(): string | null {
  const hash = window.location.hash
  if (!hash) return null
  const code = parseCodeFromHash(hash)
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  return code
}
