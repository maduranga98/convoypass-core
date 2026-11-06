// Initial download per route, from Vite's build manifest. Pure so it can be tested; scripts/bundle-report.ts does the I/O.
export interface ManifestChunk {
  file: string
  src?: string
  isEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
}
export type Manifest = Record<string, ManifestChunk>

/** Every file needed to run a chunk at start-up: the chunk, its static imports (recursively) and their CSS. Dynamic imports are NOT included. */
export function initialFiles(manifest: Manifest, key: string, seen = new Set<string>()): Set<string> {
  const chunk = manifest[key]
  if (!chunk || seen.has(key)) return new Set()
  seen.add(key)
  const files = new Set<string>([chunk.file, ...(chunk.css ?? [])])
  for (const dep of chunk.imports ?? []) for (const f of initialFiles(manifest, dep, seen)) files.add(f)
  return files
}

export const keyForSource = (manifest: Manifest, src: string): string | undefined =>
  Object.entries(manifest).find(([, c]) => c.src === src)?.[0]

export interface RouteSpec {
  name: string
  /** Source modules loaded for this route, besides the shell. */
  sources: string[]
}

export const ROUTES: RouteSpec[] = [
  { name: 'Login', sources: ['src/features/auth/LoginPage.tsx'] },
  { name: 'Driver home (/driver)', sources: ['src/features/passes/DriverHome.tsx'] },
  { name: 'Driver pre-trip form (/v/:id)', sources: ['src/features/passes/DriverHome.tsx', 'src/features/passes/VehicleRoute.tsx'] },
  { name: 'Security gate (/security)', sources: ['src/features/gate/SecurityLayout.tsx', 'src/features/gate/GateHome.tsx'] },
  { name: 'Security vehicle view (/v/:id)', sources: ['src/features/gate/SecurityLayout.tsx', 'src/features/passes/VehicleRoute.tsx'] },
  { name: 'Security QR scanner (loaded on tap)', sources: ['src/features/gate/SecurityLayout.tsx', 'src/features/gate/GateHome.tsx', 'src/features/gate/QrScanner.tsx'] },
  { name: 'Supervisor home', sources: ['src/features/supervisor/SupervisorLayout.tsx', 'src/features/supervisor/SupervisorHome.tsx'] },
  { name: 'Operator console (/platform/invites)', sources: ['src/features/platform/PlatformLayout.tsx', 'src/features/platform/InvitesPage.tsx'] },
  { name: 'Admin dashboard (recharts)', sources: ['src/features/admin/AdminLayout.tsx', 'src/features/dashboard/DashboardPage.tsx'] },
]

export function routeFiles(manifest: Manifest, spec: RouteSpec, entryKey = 'index.html'): Set<string> {
  const files = initialFiles(manifest, entryKey)
  for (const src of spec.sources) {
    const key = keyForSource(manifest, src)
    if (key) for (const f of initialFiles(manifest, key)) files.add(f)
  }
  return files
}
