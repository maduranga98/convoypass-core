// Setup invites for the operator: `create`, `list`, `revoke`. Logic only; `invites.ts` wires Firestore to it.
// The code exists in exactly one place: the link `create` prints once. Only its SHA-256 hash is stored, and nothing
// else here ever prints a code (list and revoke show a hash prefix).
import { parseArgs } from 'node:util'
import {
  generateInviteCode, hashInviteCode, INVITE_DEFAULT_DAYS, INVITE_MAX_DAYS, INVITE_MIN_DAYS, inviteLink, inviteStatus,
} from '../functions/src/tenants/inviteCode.ts'
import { platformAudit, type PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'
import { COMMON_OPTIONS, resolveTarget, type Firebaserc } from './lib/env.ts'

export interface StoredInvite {
  createdAtMs: number
  expiresAtMs: number
  companyHint?: string
  emailLock?: string
  claimedAtMs: number | null
  usedAtMs: number | null
  tenantId: string | null
}

export interface InviteStore {
  /** The invite and its `platformAuditLog` entry are written together (one batch), so there is never one without the other. */
  create(hash: string, invite: StoredInvite, audit: PlatformAuditEntry): Promise<void>
  list(): Promise<{ hash: string; invite: StoredInvite }[]>
  delete(hash: string, audit: PlatformAuditEntry): Promise<void>
}

export interface CliIo {
  store: InviteStore
  now: () => number
  out: (line: string) => void
  /** `APP_BASE_URL`. */
  appBaseUrl: string | undefined
  firebaserc: Firebaserc
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY_MS = 86_400_000
const USAGE = 'usage: invites <create|list|revoke> --env <emulator|staging|prod> [--confirm-prod] ...'

class UsageError extends Error {}

export interface ParsedCreate { company?: string; lockEmail?: string; expiresDays: number }

export function parseCreateOptions(v: { company?: string | undefined; 'lock-email'?: string | undefined; 'expires-days'?: string | undefined }): ParsedCreate {
  const days = v['expires-days'] === undefined ? INVITE_DEFAULT_DAYS : Number(v['expires-days'])
  if (!Number.isInteger(days) || days < INVITE_MIN_DAYS || days > INVITE_MAX_DAYS) {
    throw new UsageError(`--expires-days must be a whole number from ${INVITE_MIN_DAYS} to ${INVITE_MAX_DAYS} (default ${INVITE_DEFAULT_DAYS})`)
  }
  const company = v.company?.trim()
  if (company !== undefined && (company.length < 1 || company.length > 80)) throw new UsageError('--company must be 1-80 characters')
  const lockEmail = v['lock-email']?.trim().toLowerCase()
  if (lockEmail !== undefined && !EMAIL.test(lockEmail)) throw new UsageError('--lock-email is not a valid email address')
  return { expiresDays: days, ...(company ? { company } : {}), ...(lockEmail ? { lockEmail } : {}) }
}

export function appBaseFor(env: 'emulator' | 'staging' | 'prod', raw: string | undefined): string {
  if (!raw?.trim()) throw new UsageError('APP_BASE_URL is required (the public origin of the web app, e.g. https://convoypass.com)')
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new UsageError('APP_BASE_URL is not a valid URL')
  }
  if (u.protocol !== 'https:' && !(env === 'emulator' && u.protocol === 'http:')) throw new UsageError('APP_BASE_URL must be https (http only for the emulator)')
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/** Returns the process exit code. All output goes through `io.out`. */
export async function runInvitesCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const [command, ...rest] = argv
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        ...COMMON_OPTIONS,
        company: { type: 'string' },
        'lock-email': { type: 'string' },
        'expires-days': { type: 'string' },
      },
    })
    if (command !== 'create' && command !== 'list' && command !== 'revoke') throw new UsageError(USAGE)
    // Production is refused here, before anything is read or written.
    let target
    try {
      target = resolveTarget({ env: values.env, confirmProduction: Boolean(values['confirm-prod'] || values['confirm-production']), firebaserc: io.firebaserc })
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message.replace('--confirm-production', '--confirm-prod') : String(e))
    }

    if (command === 'create') {
      const opts = parseCreateOptions(values)
      const base = appBaseFor(target.env, io.appBaseUrl)
      const code = generateInviteCode()
      const now = io.now()
      await io.store.create(hashInviteCode(code), {
        createdAtMs: now,
        expiresAtMs: now + opts.expiresDays * DAY_MS,
        ...(opts.company ? { companyHint: opts.company } : {}),
        ...(opts.lockEmail ? { emailLock: opts.lockEmail } : {}),
        claimedAtMs: null,
        usedAtMs: null,
        tenantId: null,
      }, platformAudit('script', 'invite.created', hashInviteCode(code).slice(0, 8), {
        expiresInDays: opts.expiresDays, locked: Boolean(opts.lockEmail), hasCompanyHint: Boolean(opts.company), source: 'script', env: target.env,
      }))
      io.out(`invites: created (${target.env}), expires in ${opts.expiresDays} day(s)${opts.lockEmail ? `, locked to ${opts.lockEmail}` : ''}`)
      io.out('')
      io.out(`  ${inviteLink(base, code)}`)
      io.out('')
      io.out('This link is shown ONCE and cannot be recovered. Send it over a secure channel (not a group chat or a ticket).')
      io.out('Whoever opens it can create the workspace and its first admin. Revoke with: npm run invite:revoke -- --env ' + target.env + ' ' + hashInviteCode(code).slice(0, 8))
      return 0
    }

    if (command === 'list') {
      const rows = await io.store.list()
      if (rows.length === 0) {
        io.out('invites: none')
        return 0
      }
      const now = io.now()
      io.out(['hash', 'status', 'expires (UTC)', 'company', 'locked to'].join('\t'))
      for (const { hash, invite } of rows.sort((a, b) => b.invite.createdAtMs - a.invite.createdAtMs)) {
        const status = inviteStatus({ expiresAtMs: invite.expiresAtMs, usedAtMs: invite.usedAtMs, claimedAtMs: invite.claimedAtMs }, now)
        io.out([hash.slice(0, 8), status, new Date(invite.expiresAtMs).toISOString().slice(0, 16).replace('T', ' '), invite.companyHint ?? '-', invite.emailLock ?? '-'].join('\t'))
      }
      return 0
    }

    // revoke <hashPrefix>
    const prefix = (positionals[0] ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(prefix)) throw new UsageError('revoke needs the hash prefix from `invite:list` (at least 8 hex characters)')
    const matches = (await io.store.list()).filter((r) => r.hash.startsWith(prefix))
    if (matches.length === 0) throw new UsageError('no invite with that hash prefix')
    if (matches.length > 1) throw new UsageError('that prefix matches more than one invite: use more characters')
    const { hash, invite } = matches[0]!
    if (invite.usedAtMs !== null) throw new UsageError('that invite was already used (it created a tenant): it is kept as a record and cannot be deleted')
    await io.store.delete(hash, platformAudit('script', 'invite.revoked', hash.slice(0, 8), { source: 'script', env: target.env }))
    io.out(`invites: revoked ${hash.slice(0, 8)}`)
    return 0
  } catch (e) {
    io.out(`invites: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
