/**
 * WCAG 2.1 AA contrast check for the brand palette in src/index.css (@theme).
 *   npm run contrast
 * Reads the tokens from the stylesheet (one source of truth) and checks every pairing the app uses. Text needs 4.5:1
 * (3:1 for large text), icons/borders/focus rings need 3:1. Exits 1 on any failure.
 */
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const theme = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'))
const tokens = new Map<string, string>()
for (const m of theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) tokens.set(m[1] as string, (m[2] as string).toLowerCase())

const channel = (v: number): number => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
export const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
const get = (name: string): string => {
  const v = tokens.get(name)
  if (!v) throw new Error(`Unknown token --color-${name}`)
  return v
}

type Kind = 'text' | 'large' | 'ui'
const MIN: Record<Kind, number> = { text: 4.5, large: 3, ui: 3 }

/** [foreground token, background token, what it is, kind] */
const PAIRS: [string, string, string, Kind][] = [
  ['ink', 'surface', 'Body text on white', 'text'],
  ['ink', 'slate-50', 'Body text on the page background', 'text'],
  ['slate-700', 'surface', 'Secondary text', 'text'],
  ['slate-600', 'surface', 'Muted text', 'text'],
  ['slate-600', 'slate-50', 'Muted text on the page background', 'text'],
  ['slate-500', 'surface', 'Hint / placeholder text', 'text'],
  ['slate-500', 'slate-50', 'Hint text on the page background', 'text'],
  ['on-solid', 'brand', 'Primary button', 'text'],
  ['on-solid', 'brand-hover', 'Primary button (hover)', 'text'],
  ['ink', 'accent', 'Text on amber (gate "pending", counters)', 'text'],
  ['ink', 'accent-hover', 'Text on amber (hover)', 'text'],
  ['ink', 'accent-soft', 'Active navigation, selected card', 'text'],
  ['on-solid', 'success-strong', 'Approved / checked in (gate, driver, officer)', 'text'],
  ['on-solid', 'success-hover', 'Approve button (hover)', 'text'],
  ['success-strong', 'success-soft', 'Success badge and notice', 'text'],
  ['success-strong', 'surface', 'Success text on white', 'text'],
  ['success-ink', 'success-soft', 'Success notice body', 'text'],
  ['on-solid', 'danger', 'Danger button', 'text'],
  ['on-solid', 'danger-strong', 'Rejected / denied (gate, driver, officer)', 'text'],
  ['on-solid', 'danger-hover', 'Reject button (hover)', 'text'],
  ['danger', 'surface', 'Inline field error text', 'text'],
  ['danger-strong', 'danger-soft', 'Danger badge and error banner', 'text'],
  ['danger-strong', 'surface', 'Danger text on white', 'text'],
  ['danger-ink', 'danger-soft', 'Error banner body', 'text'],
  ['warning-strong', 'surface', 'Warning text on white', 'text'],
  ['warning-ink', 'warning-soft', 'Warning banner', 'text'],
  ['warning-ink', 'accent-soft', 'Warning banner (stronger fill)', 'text'],
  ['ink', 'warning-soft', 'Gate notice', 'text'],
  ['slate-300', 'brand', 'Supervisor sidebar and top bar: secondary text', 'text'],
  ['on-solid', 'brand-hover', 'Supervisor sidebar item (hover)', 'text'],
  // Non-text: icons, borders, rings and the thin parts of controls.
  ['focus', 'surface', 'Focus ring on white', 'ui'],
  ['focus', 'slate-50', 'Focus ring on the page background', 'ui'],
  ['danger', 'surface', 'Invalid field border', 'ui'],
  ['success', 'surface', 'Success icon', 'ui'],
  ['warning', 'surface', 'Warning icon', 'ui'],
  ['slate-500', 'surface', 'Unchecked control border', 'ui'],
  ['brand', 'surface', 'Switch / checkbox on', 'ui'],
  ['on-solid', 'brand', 'Focus ring on the red bars', 'ui'],
  ['accent', 'brand', 'Active item and badges on the red sidebar', 'ui'],
]

let failed = 0
for (const [fg, bg, what, kind] of PAIRS) {
  const r = ratio(get(fg), get(bg))
  const ok = r >= MIN[kind]
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (needs ${MIN[kind]})  ${what}  [${fg} on ${bg}]`)
}
console.log(failed === 0 ? `\nAll ${PAIRS.length} pairings meet WCAG AA.` : `\n${failed} pairing(s) fail WCAG AA.`)
process.exit(failed === 0 ? 0 : 1)
