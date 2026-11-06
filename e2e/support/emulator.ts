// Test-side wrapper around the Admin SDK helper (a separate process: see admin.ts).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { PLATE, PROJECT, VEHICLE } from './constants.ts'

export * from './constants.ts'

const SEED_FILE = 'e2e/.seed.json'

function admin<T>(command: string, args: Record<string, string> = {}): T {
  const out = execFileSync('npx', ['tsx', 'e2e/support/admin.ts', command, JSON.stringify(args)], { encoding: 'utf8', env: process.env })
  const line = out.split('\n').find((l) => l.startsWith('RESULT '))
  if (!line) throw new Error(`admin ${command}: no result\n${out}`)
  return JSON.parse(line.slice('RESULT '.length)) as T
}

export const seed = (): void => writeFileSync(SEED_FILE, JSON.stringify(admin<Record<string, string>>('seed')))
export const uids = (): Record<string, string> => JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Record<string, string>

/** What `submitPass` leaves behind: the real Firestore trigger then notifies the contractor's supervisors. */
export const writePass = (status: string, vehicleId = VEHICLE, plateNo = PLATE): string =>
  admin<string>('writePass', { status, vehicleId, plateNo, driverId: uids().driver ?? '' })
export const writeSubmittedPass = (vehicleId = VEHICLE, plateNo = PLATE): string => writePass('submitted', vehicleId, plateNo)

export const notificationsFor = (uid: string) => admin<{ id: string; read: boolean }[]>('notificationsFor', { uid })

const APP = 'http://127.0.0.1:5173'

/** Runs the real operator script against the emulators (so the e2e run covers `invite:create` and `admin:reset` too). */
function script(file: string, args: string[]): string {
  return execFileSync('npx', ['tsx', file, ...args], {
    encoding: 'utf8',
    env: { ...process.env, APP_BASE_URL: APP, FIREBASE_PROJECT_ID: PROJECT, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
  })
}

export interface CreatedInvite {
  link: string
  code: string
  hashPrefix: string
}

/** `npm run invite:create`: returns the one-time link as printed by the script. */
export function createInvite(opts: { company?: string; lockEmail?: string; expiresDays?: number } = {}): CreatedInvite {
  const out = script('scripts/invites.ts', [
    'create', '--env', 'emulator',
    ...(opts.company ? ['--company', opts.company] : []),
    ...(opts.lockEmail ? ['--lock-email', opts.lockEmail] : []),
    ...(opts.expiresDays ? ['--expires-days', String(opts.expiresDays)] : []),
  ])
  const link = /(http\S+\/setup#code=\S+)/.exec(out)?.[1]
  const hashPrefix = /invite:revoke -- --env emulator (\w+)/.exec(out)?.[1]
  if (!link || !hashPrefix) throw new Error(`invite:create printed no link\n${out}`)
  return { link, code: link.split('#code=')[1] as string, hashPrefix }
}
export const expireInvite = (hashPrefix: string): void => void admin('expireInvite', { hashPrefix })
export const tenantByName = (name: string): Record<string, unknown> => admin<Record<string, unknown>>('tenantByName', { name })

/** `npm run admin:reset`: the printed secret (reset link or temporary password). */
export function adminReset(email: string, mode: '--link' | '--temp-password'): string {
  const out = script('scripts/reset-admin.ts', ['--env', 'emulator', '--email', email, mode])
  const secret = out.split('\n').map((l) => l.trim()).find((l) => (mode === '--link' ? l.startsWith('http') : /^[A-Za-z0-9]{16}$/.test(l)))
  if (!secret) throw new Error(`admin:reset printed no secret\n${out}`)
  return secret
}

/** The emulator's outbox of Auth emails: what Firebase would have sent. Newest last. */
export async function oobCodes(email: string, type?: 'PASSWORD_RESET' | 'VERIFY_EMAIL'): Promise<{ oobCode: string; requestType: string }[]> {
  const res = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; oobCode: string; requestType: string }[] }
  return oobCodes.filter((c) => c.email === email && (!type || c.requestType === type))
}
export const oobCodeFromLink = (link: string): string => new URL(link).searchParams.get('oobCode') ?? ''

export interface ScriptRun {
  code: number
  out: string
}

/** Runs a script and keeps going on a non-zero exit (the refusals are what some tests check). */
function scriptResult(file: string, args: string[]): ScriptRun {
  try {
    return { code: 0, out: script(file, args) }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** `npm run superadmin:create`: the generated password as printed (once) by the script. */
export function superadminCreate(email: string, name: string, extra: string[] = []): ScriptRun & { password: string | undefined } {
  const r = scriptResult('scripts/create-operator.ts', ['--env', 'emulator', '--email', email, '--name', name, ...extra])
  return { ...r, password: /temporary password: (\S+)/.exec(r.out)?.[1] }
}
export const superadminDoctor = (email: string, extra: string[] = []): ScriptRun => scriptResult('scripts/superadmin-doctor.ts', ['--env', 'emulator', '--email', email, ...extra])
export const breakOperator = (email: string, what: 'claims' | 'tenant-claim' | 'profile' | 'email'): void => void admin('breakOperator', { email, what })
