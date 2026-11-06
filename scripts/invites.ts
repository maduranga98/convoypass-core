/**
 * Setup invites. One invite = one link = one new workspace and its first admin.
 *
 *   npm run invite:create -- --env emulator --company "Acme Quarry" --lock-email ops@acme.test --expires-days 7
 *   npm run invite:list   -- --env staging
 *   npm run invite:revoke -- --env prod --confirm-prod 1a2b3c4d
 *
 * Needs APP_BASE_URL (the public origin, e.g. https://convoypass.com; read from the environment or `.env`).
 * The link is printed once; only its hash is stored. Environment handling: scripts/lib/env.ts.
 */
import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { connect, loadDotEnv, main, readJson, type Firebaserc, type Target } from './lib/env.ts'
import { runInvitesCli, type InviteStore, type StoredInvite } from './invitesCli.ts'

loadDotEnv()

const HELP = `
Setup invites: create, list or revoke the one-time workspace setup links.

  npm run invite:create -- --env <env> [--company "Name"] [--lock-email a@b.co] [--expires-days 1-30]
  npm run invite:list   -- --env <env>
  npm run invite:revoke -- --env <env> <hash-prefix>

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text

The link is printed once and cannot be recovered. APP_BASE_URL must be set (environment or .env).
`

const storeFor = (target: Target): InviteStore => {
  const { db } = connect(target)
  const col = db.collection('setupInvites')
  const ms = (v: unknown): number | null => (v instanceof Timestamp ? (v as Timestamp).toMillis() : null)
  return {
    create: async (hash, i, audit) => {
      const batch = db.batch()
      batch.create(col.doc(hash), {
        createdAt: Timestamp.fromMillis(i.createdAtMs),
        expiresAt: Timestamp.fromMillis(i.expiresAtMs),
        ...(i.companyHint ? { companyHint: i.companyHint } : {}),
        ...(i.emailLock ? { emailLock: i.emailLock } : {}),
        claimedAt: null, claimId: null, usedAt: null, tenantId: null,
      })
      batch.create(db.collection('platformAuditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
    list: async () =>
      (await col.get()).docs.map((d: QueryDocumentSnapshot): { hash: string; invite: StoredInvite } => {
        const x = d.data()
        return {
          hash: d.id,
          invite: {
            createdAtMs: ms(x.createdAt) ?? 0, expiresAtMs: ms(x.expiresAt) ?? 0, claimedAtMs: ms(x.claimedAt), usedAtMs: ms(x.usedAt),
            tenantId: typeof x.tenantId === 'string' ? x.tenantId : null,
            ...(typeof x.companyHint === 'string' ? { companyHint: x.companyHint } : {}),
            ...(typeof x.emailLock === 'string' ? { emailLock: x.emailLock } : {}),
          },
        }
      }),
    delete: async (hash, audit) => {
      const batch = db.batch()
      batch.delete(col.doc(hash))
      batch.create(db.collection('platformAuditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
  }
}

main({
  name: 'invites',
  help: HELP,
  action: (argv) => ({ create: 'create a one-time workspace setup link (printed once)', list: 'list setup invites (hash prefixes only)', revoke: 'revoke an unused setup invite' })[argv[0] ?? ''] ?? 'manage setup invites',
  run: (argv, target) =>
    runInvitesCli(argv, {
      store: storeFor(target), now: () => Date.now(), out: (l) => console.log(l), appBaseUrl: process.env.APP_BASE_URL, firebaserc: readJson<Firebaserc>('.firebaserc'),
    }),
})
