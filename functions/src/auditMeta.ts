// Pure (no firebase imports): shared by `core.ts`, the platform audit and the operator scripts.
import type { AuditEntry } from './types.js'

/**
 * Audit `meta` is short scalars only. Whatever a caller passes, secrets never reach the log: values under keys that
 * name a credential keep only their type (booleans and numbers), and strings that look like URLs, data URIs, JWTs
 * or long blobs (photo URLs, file contents) are replaced. Nothing here is expected to trigger; it is the net under
 * the redaction test (`audit.redaction.test.ts`).
 */
const SECRET_KEY = /passw|passphrase|pin$|^pin|token|secret|credential|apikey|authorization|dataurl|base64|content|bytes/i
const SECRET_VALUE = /https?:\/\/|data:|^eyJ|[A-Za-z0-9+/_-]{60,}/

export function sanitiseMeta(meta: AuditEntry['meta']): AuditEntry['meta'] {
  const out: AuditEntry['meta'] = {}
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' && (SECRET_KEY.test(key) || SECRET_VALUE.test(value) || value.length > 200)) {
      out[key] = '[redacted]'
    } else {
      out[key] = value
    }
  }
  return out
}
