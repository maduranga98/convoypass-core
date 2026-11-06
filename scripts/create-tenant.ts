/**
 * Creates a tenant and its first admin, in the emulator, staging or production.
 *
 *   npm run create-tenant -- --env emulator --tenant-name "Acme Quarry" --email admin@acme.test
 *   npm run create-tenant -- --env staging  --tenant-name "Acme Quarry" --email ... [--name "Admin"] [--timezone Asia/Colombo]
 *   pass show acme-admin | npm run create-tenant -- --env prod --confirm-prod --tenant-name "Acme Quarry" --email ... --password-stdin
 *
 * The admin password is generated and printed once, or piped in with --password-stdin (never an argument). Environment
 * handling (banner, prod confirmation, credentials): scripts/lib/env.ts. The admin must change the password at first login
 * (unless --keep-password).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { parseArgs } from 'node:util'
import { newTenantId, provisionTenant } from '../functions/src/tenants/tenantDefaults.ts'
import { COMMON_OPTIONS, connect, main } from './lib/env.ts'
import { assertPassword, generatePassword, readPasswordFromStdin, WHY_NO_PASSWORD_FLAG } from './lib/secrets.ts'

const HELP = `
Create a workspace (tenant) and its first admin.

  npm run create-tenant -- --env <env> --tenant-name "Acme Quarry" --email admin@acme.test
         [--name "Admin"] [--timezone Asia/Colombo] [--tenant-id acme] [--keep-password] [--password-stdin]

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --password-stdin                read the admin password from stdin (10+ characters); otherwise one is generated
                                  and printed once. There is no --password argument.
  --help                          this text

Prefer the invite link or the Super admin console for real clients; this is the operator fallback.
`

const OPTIONS = {
  ...COMMON_OPTIONS,
  email: { type: 'string' },
  password: { type: 'string' },
  'password-stdin': { type: 'boolean', default: false },
  name: { type: 'string' },
  'tenant-name': { type: 'string' },
  'tenant-id': { type: 'string' },
  timezone: { type: 'string' },
  'keep-password': { type: 'boolean', default: false },
} as const

main({
  name: 'create-tenant',
  help: HELP,
  action: (argv) => `create a workspace and its first admin (${argv.includes('--password-stdin') ? 'password from stdin' : 'password generated, printed once'})`,
  run: async (argv, target) => {
    const { values } = parseArgs({ args: argv, options: OPTIONS })
    const fail = (msg: string): number => {
      console.error(`create-tenant: ${msg}`)
      return 1
    }
    if (values.password !== undefined) return fail(WHY_NO_PASSWORD_FLAG)
    const email = (values.email ?? process.env.CREATE_TENANT_ADMIN_EMAIL ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('admin email required (--email or CREATE_TENANT_ADMIN_EMAIL)')
    const tenantName = values['tenant-name']?.trim()
    if (!tenantName) return fail('--tenant-name is required')
    const timezone = values.timezone ?? 'Asia/Colombo'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      return fail(`unknown timezone "${timezone}" (use an IANA name such as Asia/Colombo)`)
    }

    let password: string
    let generated: boolean
    try {
      const supplied = values['password-stdin'] ? await readPasswordFromStdin() : process.env.CREATE_TENANT_ADMIN_PASSWORD
      generated = !supplied
      password = supplied || generatePassword(20)
      assertPassword(password, email, 10)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }

    const { auth, db } = connect(target)
    // Default: `ten_` + 10 random chars, like tenants made by the setup link. --tenant-id still pins a readable id.
    const tenantId = values['tenant-id'] ?? newTenantId()
    if ((await db.doc(`tenants/${tenantId}`).get()).exists) return fail(`tenant "${tenantId}" already exists (use --tenant-id for another)`)
    if (await auth.getUserByEmail(email).catch(() => null)) return fail(`an Auth user with ${email} already exists`)

    const adminName = values.name ?? 'Admin'
    const user = await auth.createUser({ email, password, displayName: adminName })
    try {
      await auth.setCustomUserClaims(user.uid, { role: 'admin', tenantId })
      const batch = db.batch()
      // Defaults, the admin doc and the audit entries come from provisionTenant: the same code the setup link runs.
      provisionTenant(db, batch, {
        tenantId, tenantName, timezone,
        admin: { uid: user.uid, name: adminName, email, mustChangePassword: !values['keep-password'], createdBy: 'create-tenant' },
        actor: { uid: 'create-tenant', role: 'system' }, meta: { env: target.env }, createdAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()
    } catch (e) {
      await auth.deleteUser(user.uid).catch(() => undefined)
      throw e
    }
    console.log(`create-tenant: ${target.env} ready. tenant="${tenantId}" admin=${email} uid=${user.uid}`)
    if (generated) {
      console.log('')
      console.log(`  temporary password: ${password}`)
      console.log('')
      console.log('Shown ONCE. Store it in a password manager and hand it over securely.')
    }
    if (!values['keep-password']) console.log('create-tenant: the admin must change the password at first login')
    return 0
  },
})
