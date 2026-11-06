/**
 * EMULATOR ONLY. Creates (or repairs) a demo super admin with fixed, dev-only credentials, so /platform/login works
 * right after `npm run emulators`. Hard-fails for any other environment.
 *
 *   npm run dev:superadmin
 */
import { main } from './lib/env.ts'
import { operatorIo } from './operatorIo.ts'
import { runDevSuperadmin } from './operatorsCli.ts'

const HELP = `
DEV ONLY. Create or repair the demo super admin in the Auth/Firestore emulators with fixed credentials (printed).

  npm run dev:superadmin        (adds --env emulator)

  --env emulator   required; staging and prod are refused
  --help           this text
`

main({
  name: 'dev:superadmin',
  help: HELP,
  allowed: ['emulator'],
  action: () => 'create or repair the DEV-ONLY demo super admin (fixed credentials, emulator only)',
  run: (argv, target) => runDevSuperadmin(argv, operatorIo(target)),
})
