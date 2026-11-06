/**
 * Recovers a locked-out admin (lost password, mailbox gone). Email reset from the login page comes first; this is the
 * operator fallback.
 *
 *   npm run admin:reset -- --env staging --email admin@acme.test --link
 *   npm run admin:reset -- --env staging --email admin@acme.test --temp-password
 *   npm run admin:reset -- --env prod --confirm-prod --email admin@acme.test --link
 *
 * `--link` prints a password reset link; `--temp-password` sets a random password (printed once, change forced,
 * sessions revoked). Only admins; writes an `admin.recovery` audit entry. Reset links use APP_BASE_URL for the continue URL.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { connect, loadDotEnv, main, readJson, type Firebaserc } from './lib/env.ts'
import { randomTempPassword, runAdminReset, type AdminResetIo } from './adminResetCli.ts'

loadDotEnv()

const HELP = `
Recover a locked-out workspace admin.

  npm run admin:reset -- --env <env> --email admin@acme.test --link            print a password reset link
  npm run admin:reset -- --env <env> --email admin@acme.test --temp-password   set a temporary password (printed once)

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text

Only workspace admins. Output is the only place the link or password ever appears.
`

main({
  name: 'admin:reset',
  help: HELP,
  action: (argv) => (argv.includes('--link') ? 'print a password reset link for a workspace admin' : 'set a temporary password for a workspace admin (printed once)'),
  run: (argv, target) => {
    const { auth, db } = connect(target)
    const io: AdminResetIo = {
      auth: {
        getUserByEmail: (email) => auth.getUserByEmail(email).catch(() => null),
        generatePasswordResetLink: (email, url) => auth.generatePasswordResetLink(email, url ? { url } : undefined),
        updatePassword: async (uid, password) => void (await auth.updateUser(uid, { password })),
        revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
      },
      db: {
        getUser: async (uid) => (await db.doc(`users/${uid}`).get()).data() ?? null,
        requireChangeAtNextLogin: async (uid) => void (await db.doc(`users/${uid}`).update({ mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() })),
        writeAudit: async (entry) => void (await db.collection('auditLog').doc().create({ ...entry, createdAt: FieldValue.serverTimestamp() })),
      },
      out: (l) => console.log(l),
      firebaserc: readJson<Firebaserc>('.firebaserc'),
      appBaseUrl: process.env.APP_BASE_URL,
      randomPassword: () => randomTempPassword(),
    }
    return runAdminReset(argv, io)
  },
})
