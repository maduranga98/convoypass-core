import { logWarn } from './logger.js'

export interface CspViolation {
  directive: string
  /** Host and path only (no scheme, no query), or a keyword such as `inline`, `eval`, `data`, `blob`. */
  blocked: string
  /** Where it happened: path of the page only. */
  page: string
  disposition: string
}

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS = 10

/** `https://host/path?q#f` -> `host/path`; keywords stay as they are; anything odd becomes `unknown`. */
export function reduceUri(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'unknown'
  if (/^(inline|eval|data|blob|self|wasm-eval|trusted-types-policy)$/.test(value)) return value
  try {
    const u = new URL(value)
    return `${u.host}${u.pathname}`.slice(0, 120)
  } catch {
    return 'unknown'
  }
}

const pageOf = (value: unknown): string => {
  try {
    return typeof value === 'string' ? new URL(value).pathname.slice(0, 80) : 'unknown'
  } catch {
    return 'unknown'
  }
}

const str = (v: unknown, max = 60): string => (typeof v === 'string' ? v.slice(0, max) : 'unknown')

/** Handles both report formats: the classic `{ "csp-report": {...} }` and the Reporting API array. */
export function parseCspReports(body: unknown): CspViolation[] {
  const items: unknown[] = Array.isArray(body) ? body : [body]
  const out: CspViolation[] = []
  for (const item of items.slice(0, MAX_REPORTS)) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const r = (rec['csp-report'] ?? (rec.type === 'csp-violation' ? rec.body : null)) as Record<string, unknown> | null
    if (!r || typeof r !== 'object') continue
    out.push({
      directive: str(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? r.violatedDirective),
      blocked: reduceUri(r['blocked-uri'] ?? r.blockedURL ?? r.blockedUri),
      page: pageOf(r['document-uri'] ?? r.documentURL),
      disposition: str(r.disposition ?? 'report'),
    })
  }
  return out
}

export interface MinimalRequest {
  method: string
  body: unknown
  /** Browsers send `application/csp-report` / `application/reports+json`, which Cloud Functions leave unparsed. */
  rawBody?: Buffer | undefined
  headers: Record<string, string | string[] | undefined>
}
export interface MinimalResponse {
  status(code: number): MinimalResponse
  send(body?: string): void
}

/** POST /csp-report: one structured log line per violation, nothing else. Always answers 204 (browsers ignore the body). */
export function handleCspReport(req: MinimalRequest, res: MinimalResponse): void {
  if (req.method !== 'POST') {
    res.status(405).send()
    return
  }
  const length = Number(req.headers['content-length'] ?? 0)
  if (length > MAX_BODY_BYTES) {
    res.status(413).send()
    return
  }
  let body = req.body
  if (req.rawBody && (typeof body !== 'object' || body === null || Object.keys(body).length === 0)) {
    try {
      body = JSON.parse(req.rawBody.toString('utf8'))
    } catch {
      body = null
    }
  }
  for (const v of parseCspReports(body)) logWarn({ fn: 'cspReport' }, 'ok', { ...v })
  res.status(204).send()
}
