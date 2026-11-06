/**
 * Bootstrap a tenant and its first admin (the older single-admin bootstrap; `create-tenant` is the same with more options).
 * Never creates a super admin: those come only from `superadmin:create`.
 *
 *   npm run seed:emulator -- --email a@b.com [--name "Admin"] [--tenant-name "Acme"] [--password-stdin]
 *   npm run seed:prod -- --confirm-prod --email a@b.com
 *
 * The password is generated and printed once, or piped in with --password-stdin (never an argument). Environment
 * handling (banner, prod confirmation, credentials): scripts/lib/env.ts.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { parseArgs } from 'node:util'
import { DEFAULT_TIMEZONE, provisionTenant } from '../functions/src/tenants/tenantDefaults.ts'
import { COMMON_OPTIONS, connect, main } from './lib/env.ts'
import { assertPassword, generatePassword, readPasswordFromStdin, WHY_NO_PASSWORD_FLAG } from './lib/secrets.ts'

const HELP = `
Bootstrap one tenant and its first admin.

  npm run seed:emulator -- --email a@b.com [--name "Admin"] [--tenant-name "Acme"] [--tenant-id acme] [--password-stdin]
  npm run seed:prod     -- --confirm-prod --email a@b.com ...

  --env <emulator|staging|prod>   required (the npm shortcuts seed:emulator and seed:prod add it); prod also needs
                                  --confirm-prod and the project id typed back (or --confirm-project <id> in CI)
  --password-stdin                read the admin password from stdin (10+ characters); otherwise one is generated
                                  and printed once. There is no --password argument.
  --help                          this text
`

const OPTIONS = {
  ...COMMON_OPTIONS,
  email: { type: 'string' },
  password: { type: 'string' },
  'password-stdin': { type: 'boolean', default: false },
  name: { type: 'string' },
  'tenant-name': { type: 'string' },
  'tenant-id': { type: 'string' },
  'keep-password': { type: 'boolean', default: false },
} as const

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

main({
  name: 'seed',
  help: HELP,
  action: () => 'create one tenant and its first admin (never a super admin)',
  run: async (argv, target) => {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    const fail = (msg: string): number => {
      console.error(`seed: ${msg}`)
      return 1
    }
    if (values.password !== undefined) return fail(WHY_NO_PASSWORD_FLAG)
    const email = (values.email ?? process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('admin email required (--email or SEED_ADMIN_EMAIL)')

    let password: string
    let generated: boolean
    try {
      const supplied = values['password-stdin'] ? await readPasswordFromStdin() : process.env.SEED_ADMIN_PASSWORD
      generated = !supplied
      password = supplied || generatePassword(20)
      assertPassword(password, email, 10)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }

    const { auth, db } = connect(target)
    const tenantName = values['tenant-name'] ?? 'ConvoyPass'
    const tenantId = values['tenant-id'] ?? (slug(tenantName) || 'default')
    if ((await db.doc(`tenants/${tenantId}`).get()).exists) return fail(`tenant "${tenantId}" already exists (use --tenant-id for another)`)
    if (await auth.getUserByEmail(email).catch(() => null)) return fail(`an Auth user with ${email} already exists`)

    const user = await auth.createUser({ email, password, displayName: values.name ?? 'Admin' })
    try {
      await auth.setCustomUserClaims(user.uid, { role: 'admin', tenantId })
      const batch = db.batch()
      // Defaults, the admin doc and the audit entries come from provisionTenant: the same code the setup link runs.
      provisionTenant(db, batch, {
        tenantId, tenantName, timezone: DEFAULT_TIMEZONE,
        admin: { uid: user.uid, name: values.name ?? 'Admin', email, mustChangePassword: !values['keep-password'], createdBy: 'seed' },
        actor: { uid: 'seed', role: 'system' }, meta: { env: target.env }, createdAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()
    } catch (e) {
      await auth.deleteUser(user.uid).catch(() => undefined)
      throw e
    }
    console.log(`seed: ${target.env} ready. tenant="${tenantId}" admin=${email} uid=${user.uid}`)
    if (generated) {
      console.log('')
      console.log(`  temporary password: ${password}`)
      console.log('')
      console.log('Shown ONCE. Store it in a password manager.')
    }
    if (!values['keep-password']) console.log('seed: admin must change the password on first login')
    return 0
  },
})
