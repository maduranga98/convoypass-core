/**
 * A v4 UUID for an idempotent gate request. `crypto.randomUUID` only exists in secure contexts, so a phone testing
 * over plain http on the LAN falls back to `getRandomValues` (available everywhere).
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40 // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
