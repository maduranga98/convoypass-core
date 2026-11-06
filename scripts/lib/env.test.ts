import { describe, expect, it, vi } from 'vitest'
import {
  applyEmulatorEnv, bannerLines, confirmProduction, EnvError, explainEnvironmentError, loopback, resolveTarget, runScript, targetFromArgv,
  type RunDeps, type ScriptSpec,
} from './env.ts'

const rc = { projects: { default: 'p-default', staging: 'real-staging-1', prod: 'real-prod-1' } }
const placeholders = { projects: { staging: 'REPLACE-ME-conveypass-staging', prod: 'REPLACE-ME-conveypass-prod' } }

describe('resolveTarget', () => {
  it('requires a known environment and has no default', () => {
    expect(() => resolveTarget({ env: undefined, confirmProduction: false, firebaserc: rc })).toThrow(/--env is required/)
    expect(() => resolveTarget({ env: 'live', confirmProduction: true, firebaserc: rc })).toThrow(/--env/)
    expect(() => resolveTarget({ env: 'production', confirmProduction: true, firebaserc: rc })).toThrow(/"production"/)
    expect(() => resolveTarget({ env: 'stag', confirmProduction: false, firebaserc: rc })).toThrow(/--env/)
  })
  it('emulator uses the emulator project, then the .firebaserc default, then the demo project', () => {
    expect(resolveTarget({ env: 'emulator', confirmProduction: false, firebaserc: {}, emulatorProject: 'demo-x' })).toEqual({ env: 'emulator', projectId: 'demo-x' })
    expect(resolveTarget({ env: 'emulator', confirmProduction: false, firebaserc: rc })).toEqual({ env: 'emulator', projectId: 'p-default' })
    expect(resolveTarget({ env: 'emulator', confirmProduction: false, firebaserc: {} })).toEqual({ env: 'emulator', projectId: 'demo-conveypass' })
  })
  it('staging reads its alias from .firebaserc', () => {
    expect(resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: rc })).toEqual({ env: 'staging', projectId: 'real-staging-1' })
  })
  it('an emulator project override never redirects staging or prod', () => {
    expect(resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: rc, emulatorProject: 'other' }).projectId).toBe('real-staging-1')
  })
  it('production needs --confirm-prod', () => {
    expect(() => resolveTarget({ env: 'prod', confirmProduction: false, firebaserc: rc })).toThrow(/--confirm-prod/)
    expect(resolveTarget({ env: 'prod', confirmProduction: true, firebaserc: rc })).toEqual({ env: 'prod', projectId: 'real-prod-1' })
  })
  it('refuses placeholders, a missing alias and both aliases on one project', () => {
    expect(() => resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: placeholders })).toThrow(/placeholder/)
    expect(() => resolveTarget({ env: 'prod', confirmProduction: true, firebaserc: placeholders })).toThrow(/placeholder/)
    expect(() => resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: {} })).toThrow(/no project/)
    const same = { projects: { staging: 'one-project', prod: 'one-project' } }
    expect(() => resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: same })).toThrow(/both/)
    expect(() => resolveTarget({ env: 'prod', confirmProduction: true, firebaserc: same })).toThrow(/both/)
  })
})

describe('targetFromArgv', () => {
  it('reads --env and --confirm-prod (or the older --confirm-production) from raw argv', () => {
    expect(targetFromArgv(['create', '--env', 'staging', '--email', 'a@b.co'], rc).projectId).toBe('real-staging-1')
    expect(targetFromArgv(['--env=prod', '--confirm-prod'], rc).env).toBe('prod')
    expect(targetFromArgv(['--env', 'prod', '--confirm-production'], rc).env).toBe('prod')
    expect(() => targetFromArgv(['--env', 'prod'], rc)).toThrow(/--confirm-prod/)
  })
  it('fails without --env and when --env is given twice with different values', () => {
    expect(() => targetFromArgv(['--email', 'a@b.co'], rc)).toThrow(/--env is required/)
    expect(() => targetFromArgv(['--env', 'staging', '--env', 'prod', '--confirm-prod'], rc)).toThrow(/more than once/)
  })
})

describe('confirmProduction', () => {
  const prod = { env: 'prod', projectId: 'real-prod-1' } as const
  const prompt = (answer: string) => vi.fn(async () => answer)
  it('does nothing outside production', async () => {
    const p = prompt('x')
    await confirmProduction({ env: 'staging', projectId: 's' }, { confirmProject: undefined, interactive: true, prompt: p })
    expect(p).not.toHaveBeenCalled()
  })
  it('accepts the project id typed back', async () => {
    await expect(confirmProduction(prod, { confirmProject: undefined, interactive: true, prompt: prompt(' real-prod-1\n') })).resolves.toBeUndefined()
  })
  it('refuses a wrong typed project id', async () => {
    await expect(confirmProduction(prod, { confirmProject: undefined, interactive: true, prompt: prompt('real-prod-2') })).rejects.toThrow(/does not match/)
    await expect(confirmProduction(prod, { confirmProject: undefined, interactive: true, prompt: prompt('') })).rejects.toThrow(EnvError)
  })
  it('--confirm-project must match exactly and skips the prompt', async () => {
    const p = prompt('')
    await expect(confirmProduction(prod, { confirmProject: 'real-prod-1', interactive: false, prompt: p })).resolves.toBeUndefined()
    await expect(confirmProduction(prod, { confirmProject: 'real-prod-1 ', interactive: false, prompt: p })).rejects.toThrow(/does not match/)
    expect(p).not.toHaveBeenCalled()
  })
  it('refuses without a terminal and without --confirm-project', async () => {
    await expect(confirmProduction(prod, { confirmProject: undefined, interactive: false, prompt: prompt('real-prod-1') })).rejects.toThrow(/--confirm-project real-prod-1/)
  })
})

describe('emulator environment', () => {
  it('sets the host variables from firebase.json and keeps ones already set', () => {
    const env: NodeJS.ProcessEnv = {}
    applyEmulatorEnv(env, { emulators: { auth: { port: 9199 }, firestore: { port: 8181 } } })
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9199')
    expect(env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8181')
    expect(env.FIREBASE_STORAGE_EMULATOR_HOST).toBe('127.0.0.1:9199')
    const pinned: NodeJS.ProcessEnv = { FIRESTORE_EMULATOR_HOST: 'localhost:1234' }
    applyEmulatorEnv(pinned, {})
    expect(pinned.FIRESTORE_EMULATOR_HOST).toBe('localhost:1234')
  })
  it('refuses a host that is not loopback', () => {
    expect(() => applyEmulatorEnv({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }, {})).toThrow(/not a local emulator/)
  })
  it('recognises loopback emulator hosts only', () => {
    expect(loopback('127.0.0.1:8080')).toBe(true)
    expect(loopback('localhost:9099')).toBe(true)
    expect(loopback('firestore.googleapis.com:443')).toBe(false)
    expect(loopback(undefined)).toBe(false)
  })
})

describe('credential help', () => {
  const staging = { env: 'staging', projectId: 'real-staging-1' } as const
  it('prints the exact gcloud commands and the key-file alternative for credential errors', () => {
    const help = (explainEnvironmentError(new Error('Could not load the default credentials.'), staging) ?? []).join('\n')
    expect(help).toContain('gcloud auth application-default login')
    expect(help).toContain('gcloud config set project real-staging-1')
    expect(help).toContain('GOOGLE_APPLICATION_CREDENTIALS')
    expect(explainEnvironmentError(new Error('7 PERMISSION_DENIED: caller does not have permission'), staging)).not.toBeNull()
    expect(explainEnvironmentError(new Error('something else entirely'), staging)).toBeNull()
  })
  it('points at the emulators when they are not running', () => {
    expect((explainEnvironmentError(new Error('connect ECONNREFUSED 127.0.0.1:9099'), { env: 'emulator', projectId: 'p' }) ?? []).join(' ')).toContain('npm run emulators')
  })
})

describe('runScript', () => {
  const spec = (run: ScriptSpec['run'] = async () => 0): ScriptSpec => ({ name: 'demo:script', help: 'HELP TEXT', action: () => 'do the thing', run })
  const harness = (over: Partial<RunDeps> = {}) => {
    const lines: string[] = []
    const deps: RunDeps = { out: (l) => lines.push(l), firebaserc: rc, emulatorProject: undefined, interactive: false, prompt: async () => '', preflight: async () => undefined, ...over }
    return { lines, deps, text: () => lines.join('\n') }
  }

  it('fails without --env and runs nothing', async () => {
    const run = vi.fn(async () => 0)
    const h = harness()
    expect(await runScript(spec(run), ['--email', 'a@b.co'], h.deps)).toBe(1)
    expect(h.text()).toContain('--env is required')
    expect(run).not.toHaveBeenCalled()
  })
  it('prod without --confirm-prod fails before the banner, the prompt and the preflight', async () => {
    const run = vi.fn(async () => 0)
    const h = harness({ preflight: vi.fn(async () => undefined) })
    expect(await runScript(spec(run), ['--env', 'prod'], h.deps)).toBe(1)
    expect(h.text()).toContain('--confirm-prod')
    expect(h.deps.preflight).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('prod with the wrong typed project id fails and touches nothing', async () => {
    const run = vi.fn(async () => 0)
    const h = harness({ interactive: true, prompt: async () => 'real-staging-1', preflight: vi.fn(async () => undefined) })
    expect(await runScript(spec(run), ['--env', 'prod', '--confirm-prod'], h.deps)).toBe(1)
    expect(h.deps.preflight).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('prints the banner with environment, project and action, then runs', async () => {
    const run = vi.fn(async () => 0)
    const h = harness({ interactive: true, prompt: async () => 'real-prod-1' })
    expect(await runScript(spec(run), ['--env', 'prod', '--confirm-prod'], h.deps)).toBe(0)
    expect(h.text()).toContain('PROD')
    expect(h.text()).toContain('real-prod-1')
    expect(h.text()).toContain('do the thing')
    expect(run).toHaveBeenCalledWith(['--env', 'prod', '--confirm-prod'], { env: 'prod', projectId: 'real-prod-1' })
  })
  it('--confirm-project works in CI (no terminal)', async () => {
    const run = vi.fn(async () => 0)
    const h = harness()
    expect(await runScript(spec(run), ['--env', 'prod', '--confirm-prod', '--confirm-project', 'real-prod-1'], h.deps)).toBe(0)
    expect(run).toHaveBeenCalled()
  })
  it('--help prints usage and needs no environment', async () => {
    const h = harness()
    expect(await runScript(spec(), ['--help'], h.deps)).toBe(0)
    expect(h.text()).toBe('HELP TEXT')
  })
  it('a credential failure prints the gcloud commands and exits 1 without running', async () => {
    const run = vi.fn(async () => 0)
    const h = harness({ preflight: async () => { throw new Error('Could not load the default credentials') } })
    expect(await runScript(spec(run), ['--env', 'staging'], h.deps)).toBe(1)
    expect(h.text()).toContain('gcloud auth application-default login')
    expect(run).not.toHaveBeenCalled()
  })
  it('respects the environments a script allows', async () => {
    const h = harness()
    expect(await runScript({ ...spec(), allowed: ['emulator'] }, ['--env', 'staging'], h.deps)).toBe(1)
    expect(h.text()).toContain('runs only against: emulator')
  })
  it('the banner names the target', () => {
    expect(bannerLines({ env: 'emulator', projectId: 'demo-x' }, 's', 'a').join('\n')).toMatch(/EMULATOR[\s\S]*demo-x/)
  })
})
