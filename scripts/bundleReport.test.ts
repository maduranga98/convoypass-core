import { describe, expect, it } from 'vitest'
import { initialFiles, keyForSource, routeFiles, type Manifest } from './bundleReport.ts'

const manifest: Manifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_vendor.js'], dynamicImports: ['src/pages/Home.tsx'], css: ['assets/index.css'] },
  '_vendor.js': { file: 'assets/vendor.js', imports: ['_runtime.js'] },
  '_runtime.js': { file: 'assets/runtime.js' },
  'src/pages/Home.tsx': { file: 'assets/Home.js', src: 'src/pages/Home.tsx', imports: ['index.html', '_helper.js'], dynamicImports: ['src/heavy/Chart.tsx'] },
  '_helper.js': { file: 'assets/helper.js' },
  'src/heavy/Chart.tsx': { file: 'assets/Chart.js', src: 'src/heavy/Chart.tsx' },
}

describe('bundle report', () => {
  it('the shell is the entry and its static imports (and css), recursively, without dynamic imports', () => {
    expect([...initialFiles(manifest, 'index.html')].sort()).toEqual(['assets/index.css', 'assets/index.js', 'assets/runtime.js', 'assets/vendor.js'])
  })
  it('a route adds its own chunk and static imports, never what it loads on demand', () => {
    const files = routeFiles(manifest, { name: 'Home', sources: ['src/pages/Home.tsx'] })
    expect(files.has('assets/Home.js')).toBe(true)
    expect(files.has('assets/helper.js')).toBe(true)
    expect(files.has('assets/Chart.js')).toBe(false)
  })
  it('finds a chunk by its source file and tolerates a source that is not in the build', () => {
    expect(keyForSource(manifest, 'src/heavy/Chart.tsx')).toBe('src/heavy/Chart.tsx')
    expect(keyForSource(manifest, 'src/nope.tsx')).toBeUndefined()
    expect(routeFiles(manifest, { name: 'x', sources: ['src/nope.tsx'] }).size).toBe(4)
  })
  it('cycles do not loop', () => {
    const cyc: Manifest = { a: { file: 'a.js', imports: ['b'] }, b: { file: 'b.js', imports: ['a'] } }
    expect([...initialFiles(cyc, 'a')].sort()).toEqual(['a.js', 'b.js'])
  })
})
