// One environment resolver for every operator script.
//   --env emulator|staging|prod is REQUIRED (no default, no guessing)
//   project ids come from the `.firebaserc` aliases `staging` and `prod`; the emulator uses the project the emulators run under
//   a banner names the environment, the project and what the script is about to do
//   prod needs --confirm-prod AND the project id typed at a prompt (or --confirm-project <id> in CI, exact match)
//   credentials are Application Default Credentials; a missing or wrong login prints the exact commands to fix it
// Logic is pure where it can be (tests inject `out`, `prompt` and `preflight`); `runScript` does the I/O.
import { getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

export type EnvName = 'emulator' | 'staging' | 'prod'

export interface Firebaserc {
  projects?: Record<string, string | undefined>
}

export interface Target {
  env: EnvName
  /** The Firebase project the script talks to (for the emulator: the project the emulators run under). */
  projectId: string
}

/** Used when nothing else names an emulator project. */
export const DEMO_PROJECT_ID = 'demo-conveypass'

/** The shared flags. Every script spreads these into its own `parseArgs` options. */
export const COMMON_OPTIONS = {
  env: { type: 'string' },
  'confirm-prod': { type: 'boolean', default: false },
  /** Deprecated spelling of --confirm-prod, still accepted. */
  'confirm-production': { type: 'boolean', default: false },
  'confirm-project': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const

/** A refusal the user can act on. Printed as a plain message, never as a stack trace. */
export class EnvError extends Error {}

const PLACEHOLDER = /replace|placeholder|your-|todo|changeme/i

export const isEnvName = (v: string | undefined): v is EnvName => v === 'emulator' || v === 'staging' || v === 'prod'

export const readJson = <T,>(path: string): T | Record<string, never> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return {}
  }
}

/** Loads `.env` for scripts (APP_BASE_URL) without overriding the real environment. A missing file is fine. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* no .env */
  }
}

export const loopback = (hostPort: string | undefined): boolean => Boolean(hostPort && /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(hostPort))

export interface ResolveInput {
  env: string | undefined
  /** `--confirm-prod` (or its older spelling). */
  confirmProduction: boolean
  firebaserc: Firebaserc
  /** Emulator only: FIREBASE_PROJECT_ID / GCLOUD_PROJECT, for runs under another project (emulators:exec, the e2e run). Ignored for staging and prod. */
  emulatorProject?: string | undefined
}

/**
 * Staging and production read their project id from the `.firebaserc` alias of the same name and refuse a placeholder, a
 * missing alias, and two aliases that point at the same project (a typo there must never send staging work to production).
 * An environment variable never overrides a real project id.
 */
export function resolveTarget(input: ResolveInput): Target {
  const { env, confirmProduction, firebaserc } = input
  if (!isEnvName(env)) {
    throw new EnvError(`--env is required and must be "emulator", "staging" or "prod"${env ? ` (got "${env}")` : ' (there is no default)'}`)
  }
  if (env === 'emulator') return { env, projectId: input.emulatorProject || firebaserc.projects?.default || DEMO_PROJECT_ID }
  if (env === 'prod' && !confirmProduction) throw new EnvError('refusing to touch production without --confirm-prod')
  const projectId = firebaserc.projects?.[env]
  if (!projectId) throw new EnvError(`no project for "${env}": add it to .firebaserc (projects.${env})`)
  if (PLACEHOLDER.test(projectId)) throw new EnvError(`.firebaserc projects.${env} is still a placeholder ("${projectId}"): put the real project id there`)
  const other = env === 'prod' ? 'staging' : 'prod'
  if (firebaserc.projects?.[other] === projectId) throw new EnvError(`.firebaserc points both "staging" and "prod" at "${projectId}": fix it before running anything`)
  return { env, projectId }
}

/** Reads `--env` and the confirmation flags from raw argv, whatever else it contains. Two different `--env` values are refused. */
/** The project an emulator run is under: FIREBASE_PROJECT_ID, or GCLOUD_PROJECT (set by `firebase emulators:exec --project`). */
export const emulatorProjectFromEnv = (): string | undefined => process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || undefined

export function targetFromArgv(argv: string[], firebaserc: Firebaserc = readJson<Firebaserc>('.firebaserc'), emulatorProject = emulatorProjectFromEnv()): Target {
  const { values } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: { env: { type: 'string', multiple: true }, 'confirm-prod': { type: 'boolean' }, 'confirm-production': { type: 'boolean' } },
  })
  const envs = [...new Set((values.env ?? []).map(String))]
  if (envs.length > 1) throw new EnvError(`--env was given more than once (${envs.join(', ')}): name exactly one environment`)
  return resolveTarget({ env: envs[0], confirmProduction: Boolean(values['confirm-prod'] || values['confirm-production']), firebaserc, emulatorProject })
}

export const confirmProdFlag = (argv: string[]): string | undefined => {
  const { values } = parseArgs({ args: argv, strict: false, allowPositionals: true, options: { 'confirm-project': { type: 'string' } } })
  return typeof values['confirm-project'] === 'string' ? values['confirm-project'] : undefined
}

export function bannerLines(target: Target, script: string, action: string): string[] {
  const bar = '='.repeat(64)
  return [
    bar,
    ` ConvoyPass script : ${script}`,
    ` Environment       : ${target.env.toUpperCase()}${target.env === 'prod' ? '  <-- PRODUCTION, real data' : ''}`,
    ` Project ID        : ${target.projectId}${target.env === 'emulator' ? '  (local emulator, nothing leaves this machine)' : ''}`,
    ` This script will  : ${action}`,
    bar,
  ]
}

/**
 * Production needs `--confirm-prod` (checked by `resolveTarget`) and the project id typed back: interactively, or with
 * `--confirm-project <id>` for CI. Anything else, including a typo, stops here before a single call is made.
 */
export async function confirmProduction(
  target: Target,
  opts: { confirmProject: string | undefined; interactive: boolean; prompt: (question: string) => Promise<string> },
): Promise<void> {
  if (target.env !== 'prod') return
  if (opts.confirmProject !== undefined) {
    if (opts.confirmProject !== target.projectId) throw new EnvError(`--confirm-project "${opts.confirmProject}" does not match the production project "${target.projectId}"`)
    return
  }
  if (!opts.interactive) {
    throw new EnvError(`production needs the project id typed back, and this is not an interactive terminal: pass --confirm-project ${target.projectId}`)
  }
  const typed = (await opts.prompt(`Type the production project ID (${target.projectId}) to continue: `)).trim()
  if (typed !== target.projectId) throw new EnvError('the project ID you typed does not match: nothing was done')
}

/** The sentences printed when Application Default Credentials are missing or belong to the wrong account. */
export function credentialHelp(target: Target): string[] {
  return [
    `Could not authenticate to Google Cloud for project "${target.projectId}" (${target.env}).`,
    'Sign in with the account that owns the project, then point gcloud at it:',
    '',
    '  gcloud auth application-default login',
    `  gcloud config set project ${target.projectId}`,
    '',
    'Or use a service account key instead: set GOOGLE_APPLICATION_CREDENTIALS to the path of its JSON file.',
    'Check the account with: gcloud auth list',
  ]
}

const CREDENTIAL_ERROR =
  /default credentials|could not refresh access token|invalid_grant|invalid_rapt|reauth|getting metadata from plugin|permission[_ ]denied|unauthenticated|insufficient permission|caller does not have permission|\b(401|403)\b/i

/** Help text for an error that looks like a credential problem; null for anything else (those print as they are). */
export function explainEnvironmentError(e: unknown, target: Target): string[] | null {
  const msg = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: unknown })?.code
  if (target.env === 'emulator') {
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|UNAVAILABLE/i.test(msg) || code === 14) {
      return ['Could not reach the Firebase emulators.', 'Start them first in another terminal: npm run emulators']
    }
    return null
  }
  return CREDENTIAL_ERROR.test(msg) ? credentialHelp(target) : null
}

/** Sets the emulator host variables from `firebase.json` (only when not already set) and refuses anything that is not loopback. */
export function applyEmulatorEnv(env: NodeJS.ProcessEnv, firebaseJson: { emulators?: Record<string, { port?: number }> }): void {
  env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
  env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
  env.FIREBASE_STORAGE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.storage?.port ?? 9199}`
  for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'] as const) {
    if (!loopback(env[k])) throw new EnvError(`${k}=${env[k] ?? '(unset)'} is not a local emulator address: refusing to run`)
  }
}

/** A real project must never be redirected by a leftover emulator variable. */
export function clearEmulatorEnv(env: NodeJS.ProcessEnv): void {
  for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) delete env[k]
}

/** Points the Admin SDK at the target (emulator hosts, or ADC for a real project). Safe to call more than once. */
export function connect(target: Target): { auth: Auth; db: Firestore } {
  if (target.env === 'emulator') applyEmulatorEnv(process.env, readJson<{ emulators?: Record<string, { port?: number }> }>('firebase.json'))
  else clearEmulatorEnv(process.env)
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId: target.projectId })
  return { auth: getAuth(app), db: getFirestore(app) }
}

/** Cheap proof that the credentials work (or the emulator is up) before the script does anything. */
export async function preflight(target: Target): Promise<void> {
  await connect(target).auth.listUsers(1)
}

export interface ScriptSpec {
  /** npm script name, e.g. `superadmin:create`. */
  name: string
  /** Printed by --help. */
  help: string
  /** One sentence for the banner: what this run will do. */
  action: (argv: string[]) => string
  /** Environments the script may run in (default: all three). */
  allowed?: readonly EnvName[]
  /** Runs the script; returns the exit code. The target is already confirmed and reachable. */
  run: (argv: string[], target: Target) => Promise<number>
}

export interface RunDeps {
  out: (line: string) => void
  /** Banner, refusals and credential help when stdout must stay clean (--json). Defaults to stderr. */
  err?: (line: string) => void
  firebaserc: Firebaserc
  emulatorProject: string | undefined
  interactive: boolean
  prompt: (question: string) => Promise<string>
  preflight: (target: Target) => Promise<void>
}

export function realDeps(): RunDeps {
  return {
    out: (l) => console.log(l),
    firebaserc: readJson<Firebaserc>('.firebaserc'),
    emulatorProject: emulatorProjectFromEnv(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await rl.question(q)
      } finally {
        rl.close()
      }
    },
    preflight,
  }
}

/**
 * Help, target, banner, production confirmation, credential check, then the script. Returns the exit code. Nothing reads
 * or writes data before every step before `spec.run` has passed.
 */
export async function runScript(spec: ScriptSpec, argv: string[], deps: RunDeps = realDeps()): Promise<number> {
  // With --json stdout carries only the script's JSON: the banner and any refusal go to stderr.
  const out = argv.includes('--json') ? (deps.err ?? ((l: string) => console.error(l))) : deps.out
  if (argv.includes('--help') || argv.includes('-h')) {
    deps.out(spec.help.trim())
    return 0
  }
  let target: Target
  try {
    target = targetFromArgv(argv, deps.firebaserc, deps.emulatorProject)
    const allowed = spec.allowed ?? ['emulator', 'staging', 'prod']
    if (!allowed.includes(target.env)) throw new EnvError(`${spec.name} runs only against: ${allowed.join(', ')}`)
  } catch (e) {
    out(`${spec.name}: ${e instanceof Error ? e.message : String(e)}`)
    out(`Run with --help for usage. Example: npm run ${spec.name} -- --env emulator`)
    return 1
  }
  for (const l of bannerLines(target, spec.name, spec.action(argv))) out(l)
  try {
    await confirmProduction(target, { confirmProject: confirmProdFlag(argv), interactive: deps.interactive, prompt: deps.prompt })
    try {
      await deps.preflight(target)
    } catch (e) {
      const help = explainEnvironmentError(e, target)
      if (help) {
        for (const l of help) out(l)
        return 1
      }
      throw e
    }
    return await spec.run(argv, target)
  } catch (e) {
    if (e instanceof EnvError) out(`${spec.name}: ${e.message}`)
    else {
      const help = explainEnvironmentError(e, target)
      if (help) for (const l of help) out(l)
      else out(`${spec.name} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    return 1
  }
}

/** The one line every script file ends with. */
export function main(spec: ScriptSpec): void {
  runScript(spec, process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`${spec.name} failed:`, e instanceof Error ? e.message : e)
      process.exit(1)
    })
}
