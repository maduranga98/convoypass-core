// Serves dist-csp with the response headers from firebase.json (the real Content-Security-Policy-Report-Only included),
// the way Firebase Hosting does: static files, SPA fallback, /csp-report. Only difference from production: the emulator
// origins (http://127.0.0.1:*) are added to connect-src and img-src, because the app talks to the emulators here.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const PORT = 5174
const ROOT = 'dist-csp'
const config = JSON.parse(readFileSync('firebase.json', 'utf8'))
const rules = config.hosting.headers

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json' }
const reports = []

function withEmulators(policy) {
  return policy
    .replace(/connect-src ([^;]*)/, (m, v) => `connect-src ${v} http://127.0.0.1:* ws://127.0.0.1:*`)
    .replace(/img-src ([^;]*)/, (m, v) => `img-src ${v} http://127.0.0.1:*`)
}

function headersFor(path) {
  const out = {}
  const glob = (pattern) => {
    if (pattern === '**') return true
    if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -2))
    if (pattern.startsWith('/@(')) return pattern.slice(3, -1).split('|').some((n) => path === `/${n}`)
    return pattern === path
  }
  for (const rule of rules) {
    if (!glob(rule.source)) continue
    for (const h of rule.headers) out[h.key] = h.key === 'Content-Security-Policy-Report-Only' || h.key === 'Content-Security-Policy' ? withEmulators(h.value) : h.value
  }
  return out
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  if (url.pathname === '/csp-report' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try { reports.push(JSON.parse(body)) } catch { reports.push({ unparsable: true }) }
      res.writeHead(204).end()
    })
    return
  }
  if (url.pathname === '/__csp_reports') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reports))
    return
  }
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)))
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html') // SPA fallback
  const path = file === join(ROOT, 'index.html') && url.pathname !== '/index.html' ? url.pathname : `/${file.slice(ROOT.length + 1)}`
  res.writeHead(200, { ...headersFor(path), 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(PORT, '127.0.0.1', () => console.log(`cspServer on ${PORT}`))
