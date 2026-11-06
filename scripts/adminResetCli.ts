// Operator recovery for a locked-out admin. Logic only; `reset-admin.ts` wires the Admin SDK to it.
//   --link            prints a password reset link (generatePasswordResetLink); the admin picks their own password
//   --temp-password   sets a random temporary password, prints it once, forces a change at next login, revokes sessions
// Only works on users that are admins in Firestore. Writes an `admin.recovery` audit entry (method and env, no secrets).
import { randomInt } from 'node:crypto'
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, resolveTarget, type Firebaserc } from './lib/env.ts'

export interface AdminResetIo {
  auth: {
    getUserByEmail(email: string): Promise<{ uid: string } | null>
    generatePasswordResetLink(email: string, continueUrl: string | undefined): Promise<string>
    updatePassword(uid: string, password: string): Promise<void>
    revokeRefreshTokens(uid: string): Promise<void>
  }
  db: {
    getUser(uid: string): Promise<{ role?: string; tenantId?: string; status?: string } | null>
    requireChangeAtNextLogin(uid: string): Promise<void>
    writeAudit(entry: { tenantId: string; action: 'admin.recovery'; actorUid: 'admin-reset'; actorRole: 'system'; targetType: 'user'; targetId: string; meta: Record<string, string> }): Promise<void>
  }
  out: (line: string) => void
  firebaserc: Firebaserc
  appBaseUrl: string | undefined
  randomPassword: () => string
}

// No look-alike characters (0/O, 1/l/I). Four classes, so the password always passes the app's rules.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGIT = '23456789'
export function randomTempPassword(length = 16): string {
  const all = LOWER + UPPER + DIGIT
  const pick = (set: string) => set[randomInt(set.length)] as string
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), ...Array.from({ length: length - 3 }, () => pick(all))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join('')
}

class UsageError extends Error {}

export async function runAdminReset(argv: string[], io: AdminResetIo): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        ...COMMON_OPTIONS,
        email: { type: 'string' },
        link: { type: 'boolean', default: false },
        'temp-password': { type: 'boolean', default: false },
      },
    })
    let target
    try {
      target = resolveTarget({ env: values.env, confirmProduction: Boolean(values['confirm-prod'] || values['confirm-production']), firebaserc: io.firebaserc })
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message.replace('--confirm-production', '--confirm-prod') : String(e))
    }
    const email = (values.email ?? '').trim().toLowerCase()
    if (!email) throw new UsageError('--email is required')
    if (values.link === values['temp-password']) throw new UsageError('choose exactly one of --link or --temp-password')

    const user = await io.auth.getUserByEmail(email)
    if (!user) throw new UsageError(`no account with ${email}`)
    const doc = await io.db.getUser(user.uid)
    if (!doc || doc.role !== 'admin') throw new UsageError('that account is not an admin: use the app (Users > Reset credential) for other roles')

    const method = values.link ? 'link' : 'temp-password'
    if (values.link) {
      const url = io.appBaseUrl ? `${io.appBaseUrl.replace(/\/+$/, '')}/login/staff` : undefined
      const link = await io.auth.generatePasswordResetLink(email, url)
      await audit(io, doc.tenantId, user.uid, method, target.env)
      io.out(`admin:reset (${target.env}): reset link for ${email}. Shown once; send it over a secure channel.`)
      io.out('')
      io.out(`  ${link}`)
    } else {
      const password = io.randomPassword()
      await io.auth.updatePassword(user.uid, password)
      await io.auth.revokeRefreshTokens(user.uid)
      await io.db.requireChangeAtNextLogin(user.uid)
      await audit(io, doc.tenantId, user.uid, method, target.env)
      io.out(`admin:reset (${target.env}): temporary password set for ${email}. Shown once; all sessions were signed out.`)
      io.out('')
      io.out(`  ${password}`)
      io.out('')
      io.out('They must choose a new password at next login.')
    }
    if (doc.status !== 'active') io.out('warning: this admin account is disabled; recovery does not re-enable it.')
    return 0
  } catch (e) {
    io.out(`admin:reset: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

const audit = (io: AdminResetIo, tenantId: string | undefined, uid: string, method: string, env: string) =>
  io.db.writeAudit({
    tenantId: tenantId ?? '', action: 'admin.recovery', actorUid: 'admin-reset', actorRole: 'system', targetType: 'user', targetId: uid, meta: { method, env },
  })
