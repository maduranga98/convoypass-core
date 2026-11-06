/**
 * Checks (and with --fix repairs) a super admin account: Auth user, verified email, exact claims, operators profile, no
 * users doc, and that the getOperatorProfile callable is deployed. Exit code 1 on any failure.
 *
 *   npm run superadmin:doctor -- --env staging --email olive@convoypass.com [--fix] [--json]
 */
import { main } from './lib/env.ts'
import { functionsEnvFor, operatorIo } from './operatorIo.ts'
import { runDoctor } from './superadminDoctorCli.ts'

const HELP = `
Check a Super admin account and print PASS/FAIL per check, with the likely cause and the fix for each failure.

  npm run superadmin:doctor -- --env <env> --email <email> [--fix] [--json]

  --fix    repair claims, verified email and the operators profile (never the password; a disabled account stays disabled)
  --json   machine readable result on stdout (the banner goes to stderr); for CI
  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help   this text

Exit code is 1 when any check fails. The deployed-callable check is plain HTTP, no credentials are sent (skipped on the emulator).
`

main({
  name: 'superadmin:doctor',
  help: HELP,
  action: (argv) => (argv.includes('--fix') ? 'check a super admin account and REPAIR claims, verified email and profile (not the password)' : 'check a super admin account (read only)'),
  run: (argv, target) => {
    const io = operatorIo(target)
    return runDoctor(argv, {
      ...io,
      fetch: async (url, init) => ({ status: (await fetch(url, init)).status }),
      region: functionsEnvFor(target).FUNCTIONS_REGION,
    })
  },
})
