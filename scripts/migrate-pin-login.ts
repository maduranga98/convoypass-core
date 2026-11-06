/**
 * Module 12: moves existing driver and security accounts to PIN sign-in. DRY RUN by default.
 *
 *   npm run migrate:pin-login -- --env staging
 *   PIN_PEPPER="$(gcloud secrets versions access latest --secret=PIN_PEPPER --project <id>)" \
 *     npm run migrate:pin-login -- --env staging --apply --out ~/convoypass-staging-pins.csv
 *
 * Same uid, claims re-applied, no email or password left on the Auth user; a new 8-digit PIN per person, written ONLY to
 * the --out CSV (outside the repo, mode 0600). Environment handling (banner, prod confirmation, credentials):
 * scripts/lib/env.ts. Logic: scripts/migratePinLogin.ts.
 */
import { FieldValue, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, connect, main } from './lib/env.ts'
import { scriptPepper } from './lib/pinScript.ts'
import { migratePinLogin, MigrationError, type Candidate, type MigrateIo } from './migratePinLogin.ts'

const HELP = `
Move existing drivers and security users to PIN sign-in (Module 12). Dry run unless --apply.

  npm run migrate:pin-login -- --env <env>                                   list who would move (no changes)
  npm run migrate:pin-login -- --env <env> --apply --out ~/pins.csv          migrate and write the new PINs

  --env <emulator|staging|prod>   required; never defaults to production. prod also needs --confirm-prod and the
                                  project id typed back (or --confirm-project <id> in CI)
  --apply                         make the changes (otherwise a dry run)
  --out <file.csv>                where the PINs go: outside the repository, created with mode 0600, never overwritten
  --help                          this text

Staging and production need PIN_PEPPER in the environment (the deployed secret): see docs/ops.md. The emulator uses
functions/.secret.local or the development pepper. Deliver the PINs privately, then delete the file.
`

const OPTIONS = { ...COMMON_OPTIONS, apply: { type: 'boolean', default: false }, out: { type: 'string' } } as const

main({
  name: 'migrate:pin-login',
  help: HELP,
  action: (argv) =>
    argv.includes('--apply')
      ? 'MIGRATE driver and security accounts to PIN sign-in (recreates their Auth users, signs them out, writes PINs to --out)'
      : 'dry run: list the driver and security accounts that would move to PIN sign-in (no changes)',
  run: async (argv, target) => {
    const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: false })
    const apply = values.apply === true
    let pepper: string
    try {
      pepper = scriptPepper(target)
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e))
      return 1
    }
    const { auth, db } = connect(target)
    const io: MigrateIo = {
      listCandidates: async () => {
        const snap = await db.collection('users').where('role', 'in', ['driver', 'security']).get()
        return snap.docs
          .filter((d: QueryDocumentSnapshot) => d.get('loginType') !== 'pin')
          .map((d: QueryDocumentSnapshot): Candidate => ({
            uid: d.id,
            name: String(d.get('name') ?? ''),
            role: d.get('role') as Candidate['role'],
            tenantId: String(d.get('tenantId') ?? ''),
            contractorId: (d.get('contractorId') as string | null) ?? null,
            status: d.get('status') === 'disabled' ? 'disabled' : 'active',
          }))
      },
      contractorName: async (id) => ((await db.doc(`contractors/${id}`).get()).get('name') as string | undefined) ?? null,
      tenantName: async (id) => ((await db.doc(`tenants/${id}`).get()).get('name') as string | undefined) ?? null,
      replaceAuthUser: async ({ uid, displayName, disabled, claims }) => {
        await auth.deleteUser(uid).catch((e: unknown) => {
          if ((e as { code?: string }).code !== 'auth/user-not-found') throw e
        })
        await auth.createUser({ uid, displayName, disabled })
        await auth.setCustomUserClaims(uid, claims)
      },
      createPinIndex: (key, entry) =>
        db.runTransaction(async (tx: Transaction) => {
          const ref = db.doc(`pinIndex/${key}`)
          if ((await tx.get(ref)).exists) return false
          tx.create(ref, { ...entry, createdAt: FieldValue.serverTimestamp() })
          return true
        }),
      markMigrated: async (uid, patch, audit) => {
        const batch = db.batch()
        batch.update(db.doc(`users/${uid}`), { ...patch, knownDevices: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
        batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
        await batch.commit()
      },
      now: () => Math.floor(Date.now() / 1000),
      out: (l) => console.log(l),
    }
    try {
      return await migratePinLogin(io, { apply, out: typeof values.out === 'string' ? values.out : undefined, repoRoot: process.cwd(), pepper })
    } catch (e) {
      if (e instanceof MigrationError) {
        console.log(`migrate:pin-login: ${e.message}`)
        return 1
      }
      throw e
    }
  },
})
