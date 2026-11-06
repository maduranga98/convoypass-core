// Module 12 migration logic: existing driver and security accounts move to PIN sign-in. Pure apart from the injected
// I/O, so the tests drive it with fakes. The entry point is scripts/migrate-pin-login.ts.
//
// For each `users` doc with role driver or security that is not yet `loginType: 'pin'`:
//   the Auth user is deleted and recreated with the SAME uid and no email or password (disabled state kept), claims
//   re-applied; a new 8-digit PIN gets a `pinIndex/{hmac}` doc (created only if free, so PINs stay globally unique);
//   the users doc gets `loginType: 'pin'`, `mustChangePassword: false`, `pinVersion: 1`, `sessionsRevokedAt` (now);
//   one audit entry `user.migratePinLogin` (no PIN). The PINs go to ONE place: a CSV at --out (mode 0600, outside the
//   repo), for delivering them by hand. Dry run by default; `--apply` writes.
import { closeSync, fchmodSync, openSync, writeSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { formatPin, generatePin, pinKey } from '../functions/src/pin.ts'

export type PinRole = 'driver' | 'security'

export interface Candidate {
  uid: string
  name: string
  role: PinRole
  tenantId: string
  contractorId: string | null
  status: 'active' | 'disabled'
}

export interface MigrateIo {
  /** Every driver and security `users` doc that is not `loginType: 'pin'` yet. */
  listCandidates(): Promise<Candidate[]>
  contractorName(id: string): Promise<string | null>
  tenantName(id: string): Promise<string | null>
  /** Delete the Auth user (if any) and create it again with this uid, no email, no password; then set the claims. */
  replaceAuthUser(p: { uid: string; displayName: string; disabled: boolean; claims: Record<string, string> }): Promise<void>
  /** Create `pinIndex/{key}` only if it does not exist. False when the PIN is taken (try another). */
  createPinIndex(key: string, entry: { uid: string; tenantId: string; role: PinRole }): Promise<boolean>
  /** Update the users doc (and clear knownDevices) and write the tenant audit entry. */
  markMigrated(uid: string, patch: Record<string, unknown>, audit: Record<string, unknown>): Promise<void>
  /** Seconds. */
  now(): number
  out(line: string): void
  newPin?: () => string
}

export interface CsvTarget {
  /** Opens the file for writing (exclusive, mode 0600) and returns a line writer plus a close. */
  open(path: string): { write: (line: string) => void; close: () => void }
}

export class MigrationError extends Error {}

/** `--out` must be a path outside the repository (PINs never land in a checkout, even an ignored one). */
export function assertOutsideRepo(path: string, repoRoot: string): string {
  const full = resolve(path)
  const rel = relative(resolve(repoRoot), full)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new MigrationError(`--out must be outside the repository (got ${full}). Use a private folder, e.g. ~/convoypass-pins.csv`)
  }
  return full
}

export const fileCsvTarget: CsvTarget = {
  open: (path) => {
    // 'wx': refuse to overwrite an existing file; 0600: only this user can read it.
    const fd = openSync(path, 'wx', 0o600)
    fchmodSync(fd, 0o600)
    return { write: (line) => void writeSync(fd, `${line}\r\n`), close: () => closeSync(fd) }
  },
}

/** RFC 4180 field, with spreadsheet formula injection neutralised (a leading = + - @ gets a quote). */
export const csvField = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const MAX_PIN_TRIES = 20

export interface MigrateOptions {
  apply: boolean
  out: string | undefined
  repoRoot: string
  pepper: string
}

/** Returns the exit code. A dry run reads only and prints who would move. */
export async function migratePinLogin(io: MigrateIo, opts: MigrateOptions, csv: CsvTarget = fileCsvTarget): Promise<number> {
  const candidates = await io.listCandidates()
  const companyCache = new Map<string, string>()
  const company = async (c: Candidate): Promise<string> => {
    const key = c.contractorId ? `c:${c.contractorId}` : `t:${c.tenantId}`
    if (!companyCache.has(key)) {
      companyCache.set(key, (c.contractorId ? await io.contractorName(c.contractorId) : await io.tenantName(c.tenantId)) ?? '')
    }
    return companyCache.get(key) as string
  }

  io.out(`${candidates.length} account(s) to move to PIN sign-in (${candidates.filter((c) => c.role === 'driver').length} drivers, ${candidates.filter((c) => c.role === 'security').length} security).`)
  if (!opts.apply) {
    for (const c of candidates) io.out(`  would migrate  ${c.role.padEnd(8)} ${c.uid}  ${c.name} (${await company(c)})`)
    io.out('Dry run: nothing was changed. Run again with --apply --out <path outside the repo> to migrate.')
    return 0
  }
  if (!opts.out) throw new MigrationError('--apply needs --out <file.csv> (outside the repository) for the new PINs')
  const outPath = assertOutsideRepo(opts.out, opts.repoRoot)
  if (candidates.length === 0) {
    io.out('Nothing to migrate; no file was written.')
    return 0
  }

  const file = csv.open(outPath)
  let done = 0
  try {
    file.write(['name', 'role', 'company', 'pin'].join(','))
    for (const c of candidates) {
      const claims: Record<string, string> = { role: c.role, tenantId: c.tenantId, ...(c.contractorId ? { contractorId: c.contractorId } : {}) }
      await io.replaceAuthUser({ uid: c.uid, displayName: c.name, disabled: c.status === 'disabled', claims })
      let pin: string | null = null
      for (let i = 0; i < MAX_PIN_TRIES && !pin; i++) {
        const candidate = io.newPin?.() ?? generatePin()
        if (await io.createPinIndex(pinKey(candidate, opts.pepper), { uid: c.uid, tenantId: c.tenantId, role: c.role })) pin = candidate
      }
      if (!pin) throw new MigrationError(`could not find a free PIN for ${c.uid}`)
      const now = io.now()
      await io.markMigrated(
        c.uid,
        { loginType: 'pin', mustChangePassword: false, pinVersion: 1, sessionsRevokedAt: now },
        { tenantId: c.tenantId, action: 'user.migratePinLogin', actorUid: 'script', actorRole: 'system', targetType: 'user', targetId: c.uid, meta: { role: c.role } },
      )
      file.write([c.name, c.role, await company(c), formatPin(pin)].map(csvField).join(','))
      done++
      io.out(`  migrated  ${c.role.padEnd(8)} ${c.uid}  ${c.name}`)
    }
  } finally {
    file.close()
  }
  io.out(`${done} account(s) migrated. Their new PINs are in ${outPath} (readable only by you).`)
  io.out('WARNING: deliver each PIN to its person privately (in person or a direct message), then DELETE that file.')
  io.out('Every migrated person was signed out and must sign in with the new PIN.')
  return 0
}
