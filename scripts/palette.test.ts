import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src', import.meta.url).pathname

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) yield path
  }
}

/** Colours live in src/index.css (@theme). Components use the token names, never a Tailwind scale or a hex. */
describe('brand palette', () => {
  const scale = /(?<![\w-])(?:bg|text|border|ring|outline|divide|fill|stroke|accent|decoration)-(?:red|amber|emerald|green|indigo|blue|yellow|orange|sky|violet|purple|rose|white|black)(?:-\d{2,3})?(?![\w-])/g

  it('has no raw Tailwind colour classes in the app', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) for (const m of readFileSync(file, 'utf8').matchAll(scale)) offenders.push(`${file.replace(SRC, 'src')}: ${m[0]}`)
    expect(offenders).toEqual([])
  })

  it('keeps hex values in the theme, apart from canvas/QR pixels that cannot read CSS variables', () => {
    const allowed = new Set(['src/index.css', 'src/features/qr/LabelSheet.tsx', 'src/features/passes/capture.ts'])
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = file.replace(SRC, 'src')
      if (allowed.has(rel)) continue
      for (const m of readFileSync(file, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) offenders.push(`${rel}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('defines the brand colours', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8').toLowerCase()
    for (const [name, hex] of [['brand', '#a81d27'], ['ink', '#171717'], ['accent', '#f59e0b'], ['success', '#16a34a'], ['warning', '#d97706'], ['danger', '#dc2626']]) {
      expect(css).toContain(`--color-${name}: ${hex}`)
    }
  })
})
