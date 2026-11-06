/**
 * Disables a super admin: Auth user disabled, refresh tokens revoked, `operators/{uid}.status = 'disabled'`,
 * `platformAuditLog` entry. Refuses an email that is not an operator (never a way to lock out a tenant user).
 *
 *   npm run superadmin:disable -- --env staging --email olive@convoypass.com
 *   npm run superadmin:disable -- --env prod --confirm-prod --email olive@convoypass.com
 */
import { main } from './lib/env.ts'
import { operatorIo } from './operatorIo.ts'
import { runDisableOperator } from './operatorsCli.ts'

const HELP = `
Disable a Super admin: sign-in blocked, every session revoked, profile marked disabled, audit entry written.

  npm run superadmin:disable -- --env <env> --email <email>

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text

Only super admins: a tenant user is refused. To re-enable on purpose: superadmin:create ... --repair --enable.
`

main({
  name: 'superadmin:disable',
  help: HELP,
  action: () => 'disable a super admin account and sign it out everywhere',
  run: (argv, target) => runDisableOperator(argv, operatorIo(target)),
})
