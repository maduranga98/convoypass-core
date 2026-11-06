/**
 * Creates, repairs or resets a super admin (the person who runs ConvoyPass: creates workspaces and admins from /platform).
 *
 *   npm run superadmin:create -- --env staging --email olive@convoypass.com --name "Olive Operator"
 *   npm run superadmin:create -- --env prod --confirm-prod --email olive@convoypass.com --name "Olive"   (project id typed back)
 *   npm run superadmin:create -- --env staging --email olive@convoypass.com --repair
 *   npm run superadmin:create -- --env staging --email olive@convoypass.com --reset-password
 *
 * Full usage: --help. Alias: operator:create. Details: docs/superadmin.md.
 */
import { main } from './lib/env.ts'
import { operatorIo } from './operatorIo.ts'
import { runCreateOperator } from './operatorsCli.ts'

const HELP = `
Create, repair or reset a Super admin account (script only; there is no signup or UI for this).

  npm run superadmin:create -- --env <env> --email <email> --name "<Full name>"     create (password generated, printed once)
  ... --password-stdin        read the password (14+ characters, not common) from stdin instead:
                                pass show convoypass/superadmin | npm run superadmin:create -- --env <env> ... --password-stdin
  ... --repair                existing account: re-apply claims, verified email and the operators profile (never the password)
  ... --repair --enable       also re-enable an account that was disabled (deliberate)
  ... --reset-password        existing account: new temporary password (printed once), sessions revoked, change forced

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text

There is no --password argument: a password on the command line ends up in shell history.
Credentials: gcloud auth application-default login  (or GOOGLE_APPLICATION_CREDENTIALS). Alias: operator:create.
`

main({
  name: 'superadmin:create',
  help: HELP,
  action: (argv) =>
    argv.includes('--repair') ? 'repair a super admin account (claims, verified email, profile; password untouched)'
    : argv.includes('--reset-password') ? 'issue a new temporary password for a super admin (printed once) and sign them out everywhere'
    : 'create a super admin account with a one-time password (verified email, platform claims, operators profile)',
  run: (argv, target) => runCreateOperator(argv, operatorIo(target)),
})
