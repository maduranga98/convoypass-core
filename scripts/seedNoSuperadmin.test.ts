import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The seeds make workspaces and their admins. A super admin comes only from `superadmin:create` / `dev:superadmin`
// (emulator), so no seed can ever put one on staging or production.
describe('seeds never create a super admin', () => {
  for (const f of ['scripts/seed.ts', 'scripts/seed-demo.ts', 'scripts/create-tenant.ts']) {
    it(f, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/platformAdmin|role:\s*'platform'|operators\//)
    })
  }
})
