import { HttpsError } from 'firebase-functions/v2/https'
import { beforeEach, describe, expect, it } from 'vitest'
import { PIN_LIMITS } from './config.js'
import { createUser, reissuePin, updateUser } from './core.js'
import { setLogSink } from './logger.js'
import { deliver } from './notifications.js'
import { makeNotifyWorld, type NotifyWorld } from './notify-test-utils.js'
import { applyFailure, loginWithPin, MAX_KNOWN_DEVICES, PIN_FAILURE_MESSAGE, upsertDevice, type AttemptState, type KnownDevice, type PinLoginDeps } from './pinLogin.js'
import { admin, makeWorld, NOW, TEST_PEPPER, type World } from './test-utils.js'
import type { AuditEntry, Claims } from './types.js'

const DEV_A = '0b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b'
const DEV_B = '1b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b'
const device = (i: number) => `${String(i).padStart(8, '0')}-3c1e-4c1a-9f57-0c1d2e3f4a5b`
const IP_A = '203.0.113.7'
const IP_B = '198.51.100.9'
const WRONG = '13572468'

interface LoginWorld {
  w: World
  nw: NotifyWorld
  deps: PinLoginDeps
  attempts: Map<string, AttemptState>
  probe: Map<string, number>
  probeAlerts: Map<number, number>
  known: Map<string, Record<string, KnownDevice>>
  lastLogin: Map<string, number>
  audits: AuditEntry[]
  tokens: string[]
  /** Fake clock in ms; `sleep` advances it. */
  clock: { now: number; slept: number[] }
  logs: string[]
}

function makeLoginWorld(): LoginWorld {
  const w = makeWorld()
  const nw = makeNotifyWorld(w)
  const clock = { now: NOW * 1000, slept: [] as number[] }
  const lw: LoginWorld = {
    w, nw, attempts: new Map(), probe: new Map(), probeAlerts: new Map(), known: new Map(), lastLogin: new Map(), audits: [], tokens: [], clock, logs: [],
    deps: undefined as unknown as PinLoginDeps,
  }
  lw.deps = {
    limits: PIN_LIMITS,
    pepper: () => TEST_PEPPER,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.slept.push(ms)
      clock.now += ms
    },
    random: () => 0.5,
    notify: async (tenantId, planned, actor) => {
      await deliver(nw.deps, tenantId, [planned], actor, { fn: 'test' })
    },
    port: {
      getAttempts: async (keys) => new Map(keys.flatMap((k) => (lw.attempts.has(k) ? [[k, structuredClone(lw.attempts.get(k) as AttemptState)] as const] : []))),
      updateAttempts: async (key, apply) => void lw.attempts.set(key, apply(lw.attempts.get(key))),
      incrementProbe: async (windowStart, shard) => {
        const k = `${windowStart}-${shard}`
        lw.probe.set(k, (lw.probe.get(k) ?? 0) + 1)
        return lw.probe.get(k) as number
      },
      sumProbe: async (windowStart) => [...lw.probe].filter(([k]) => k.startsWith(`${windowStart}-`)).reduce((n, [, v]) => n + v, 0),
      recordProbe: async (windowStart, failures) => {
        if (lw.probeAlerts.has(windowStart)) return false
        lw.probeAlerts.set(windowStart, failures)
        return true
      },
      getPinEntry: async (key) => w.pins.get(key) ?? null,
      getUser: async (uid) => w.users.get(uid) ?? null,
      getContractor: async (id) => w.contractors.get(id) ?? null,
      getTenant: async (id) => (w.tenants.has(id) ? (w.tenants.get(id) as { status?: string }) : null),
      getAuthUser: async (uid) => (w.authUsers.has(uid) ? { disabled: w.authUsers.get(uid)?.disabled ?? false } : null),
      createCustomToken: async (uid) => {
        const token = `token-for-${uid}`
        lw.tokens.push(token)
        return token
      },
      recordLogin: async ({ uid, deviceKey, nowMs, audit }) => {
        const { devices, newDevice } = upsertDevice(lw.known.get(uid), deviceKey, nowMs)
        lw.known.set(uid, devices)
        lw.lastLogin.set(uid, nowMs)
        lw.audits.push(audit(newDevice))
        return { newDevice }
      },
    },
  }
  return lw
}

let lw: LoginWorld
let restoreLogs: () => void
beforeEach(() => {
  lw = makeLoginWorld()
  restoreLogs?.()
  restoreLogs = setLogSink({
    info: (m, f) => void lw.logs.push(JSON.stringify([m, f])),
    warn: (m, f) => void lw.logs.push(JSON.stringify([m, f])),
    error: (m, f) => void lw.logs.push(JSON.stringify([m, f])),
  })
})

const newPinUser = async (role: 'driver' | 'security', over: { contractorId?: string } = {}) => {
  const { uid, pin } = await createUser(lw.w.deps, admin(), role === 'driver' ? { role, name: 'Dan', contractorId: over.contractorId ?? 'C1' } : { role, name: 'Sam' })
  return { uid, pin: pin as string }
}

const login = (pin: unknown, deviceId: unknown = DEV_A, ip: string | undefined = IP_A) => loginWithPin(lw.deps, { pin, deviceId }, ip)

/** The full shape of a refusal, so two of them can be compared exactly. */
async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown; elapsed: number }> {
  const start = lw.clock.now
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError)
    const h = e as HttpsError
    return { code: h.code, message: h.message, details: h.details, elapsed: lw.clock.now - start }
  }
  throw new Error('expected a refusal')
}

const GENERIC = { code: 'unauthenticated', message: PIN_FAILURE_MESSAGE, details: { reason: 'pin-invalid' } }
const MIN = PIN_LIMITS.minDelayMs

describe('loginWithPin: success', () => {
  it('a valid PIN returns a custom token for the user whose claims match', async () => {
    const { uid, pin } = await newPinUser('driver')
    const { token } = await login(pin)
    expect(token).toBe(`token-for-${uid}`)
    expect(lw.w.claims.get(uid)).toEqual<Claims>({ role: 'driver', tenantId: 'T1', contractorId: 'C1' })
    expect(lw.lastLogin.get(uid)).toBe(NOW * 1000)
  })

  it('accepts the PIN with spaces, as displayed', async () => {
    const { uid, pin } = await newPinUser('security')
    expect((await login(`${pin.slice(0, 4)} ${pin.slice(4)}`)).token).toBe(`token-for-${uid}`)
  })

  it('records the device and writes auth.pin_login with a hashed device id, no IP and no PIN', async () => {
    const { uid, pin } = await newPinUser('driver')
    await login(pin)
    const entry = lw.audits.at(-1) as AuditEntry
    expect(entry).toMatchObject({ action: 'auth.pin_login', actorUid: uid, actorRole: 'driver', targetId: uid, tenantId: 'T1', meta: { newDevice: true } })
    const text = JSON.stringify(entry)
    for (const secret of [pin, DEV_A, IP_A]) expect(text).not.toContain(secret)
    expect(Object.keys(lw.known.get(uid) ?? {})).toHaveLength(1)
    expect(Object.keys(lw.known.get(uid) ?? {})[0]).not.toContain(DEV_A)
  })

  it('keeps at most 5 known devices, dropping the least recently seen', async () => {
    const { uid, pin } = await newPinUser('driver')
    for (let i = 0; i < 7; i++) {
      lw.clock.now += 1000
      await login(pin, `${i}b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b`)
    }
    expect(Object.keys(lw.known.get(uid) ?? {})).toHaveLength(MAX_KNOWN_DEVICES)
  })

  it('the PIN appears in no log line', async () => {
    const { pin } = await newPinUser('driver')
    await login(pin)
    await login(WRONG).catch(() => undefined)
    const text = lw.logs.join('\n')
    for (const secret of [pin, WRONG, DEV_A, IP_A]) expect(text).not.toContain(secret)
    expect(text).toContain('loginWithPin')
  })
})

describe('loginWithPin: one failure shape for everything', () => {
  it('unknown, suspended user, suspended contractor, disabled Auth user, malformed: identical errors after the same delay', async () => {
    const drv = await newPinUser('driver')
    const sus = await newPinUser('driver')
    const con = await newPinUser('driver', { contractorId: 'C2' })
    const dis = await newPinUser('security')
    await updateUser(lw.w.deps, admin(), { uid: sus.uid, status: 'disabled' }) // users doc disabled, Auth disabled
    lw.w.contractors.set('C2', { tenantId: 'T1', status: 'suspended' })
    lw.w.authUsers.set(dis.uid, { ...(lw.w.authUsers.get(dis.uid) as { disabled: boolean; displayName: string }), disabled: true })

    const cases = [
      () => login(WRONG),
      () => login(sus.pin),
      () => login(con.pin),
      () => login(dis.pin),
      () => login('1234'),
      () => login('abcdefgh'),
      () => login(12345678),
      () => login(drv.pin, 'not-a-uuid'),
      () => loginWithPin(lw.deps, null, IP_A),
    ]
    const results = []
    for (const c of cases) results.push(await refusal(c()))
    for (const r of results) {
      expect({ code: r.code, message: r.message, details: r.details }).toEqual(GENERIC)
      // The fake work takes no time, so every failure waits exactly the uniform minimum (400 ms + the fixed jitter).
      expect(r.elapsed).toBe(MIN + Math.floor(0.5 * (PIN_LIMITS.jitterMs + 1)))
    }
  })

  it('the minimum delay counts the time the work already took', async () => {
    const realGet = lw.deps.port.getPinEntry
    lw.deps.port.getPinEntry = async (k) => {
      lw.clock.now += 300
      return realGet(k)
    }
    const r = await refusal(login(WRONG))
    expect(r.elapsed).toBe(MIN + 75)
    expect(lw.clock.slept.at(-1)).toBe(MIN + 75 - 300)
  })

  it('an unexpected error inside is still the generic refusal', async () => {
    lw.deps.port.getPinEntry = async () => {
      throw new Error('firestore down')
    }
    expect((({ elapsed: _e, ...r }) => (void _e, r))(await refusal(login(WRONG)))).toEqual(GENERIC)
  })

  it('a missing pepper refuses every PIN the same way', async () => {
    const { pin } = await newPinUser('driver')
    lw.deps.pepper = () => undefined
    expect((({ elapsed: _e, ...r }) => (void _e, r))(await refusal(login(pin)))).toEqual(GENERIC)
  })

  it('a staff account can never sign in with a PIN, even with a forged pinIndex entry', async () => {
    const { pin } = await newPinUser('driver')
    for (const [k, e] of lw.w.pins) lw.w.pins.set(k, { ...e, uid: 'officer', role: 'security' })
    expect((({ elapsed: _e, ...r }) => (void _e, r))(await refusal(login(pin)))).toEqual(GENERIC)
    expect(lw.tokens).toHaveLength(0)
  })
})

describe('loginWithPin: throttling', () => {
  const fail = (n: number, deviceId = DEV_A, ip = IP_A) =>
    (async () => {
      for (let i = 0; i < n; i++) await login(WRONG, deviceId, ip).catch(() => undefined)
    })()

  it('locks a device after 8 failures in 15 minutes: same error plus retryAfterSeconds, keypad stays blocked even for the right PIN', async () => {
    const { pin } = await newPinUser('driver')
    await fail(7, DEV_A, IP_A)
    const eighth = await refusal(login(WRONG, DEV_A, IP_B))
    expect(eighth).toMatchObject({ code: 'unauthenticated', message: PIN_FAILURE_MESSAGE, details: { reason: 'pin-invalid', retryAfterSeconds: 900 } })
    const blocked = await refusal(login(pin, DEV_A, IP_B))
    expect(blocked.details).toMatchObject({ reason: 'pin-invalid', retryAfterSeconds: expect.any(Number) })
    expect(lw.tokens).toHaveLength(0)
  })

  it('locks an IP after 10 failures in 15 minutes; another IP is unaffected', async () => {
    const { uid, pin } = await newPinUser('driver')
    for (let i = 0; i < 10; i++) await login(WRONG, `${i}b6f5a64-3c1e-4c1a-9f57-0c1d2e3f4a5b`, IP_A).catch(() => undefined)
    expect((await refusal(login(pin, DEV_B, IP_A))).details).toMatchObject({ retryAfterSeconds: expect.any(Number) })
    expect((await login(pin, DEV_B, IP_B)).token).toBe(`token-for-${uid}`)
  })

  it('a lockout ends after its time; repeat lockouts double, up to 2 hours', async () => {
    await fail(8)
    const lockFor = (ms: number) => {
      lw.clock.now += ms
    }
    const retryAfter = async () => ((await refusal(login(WRONG))).details as { retryAfterSeconds?: number }).retryAfterSeconds
    expect(await retryAfter()).toBeGreaterThan(0) // still locked
    const lengths: number[] = []
    for (let round = 0; round < 5; round++) {
      const state = [...lw.attempts.values()].find((s) => s.lockouts > 0) as AttemptState
      lengths.push(state.lockedUntil - state.lastLockoutAt)
      lockFor(state.lockedUntil - lw.clock.now + 1)
      await fail(8)
    }
    expect(lengths).toEqual([15, 30, 60, 120, 120].map((m) => m * 60_000))
  })

  it('the failure window resets after 15 minutes without reaching the limit', async () => {
    await fail(7)
    lw.clock.now += 15 * 60_000
    await fail(7)
    expect([...lw.attempts.values()].every((s) => s.lockedUntil <= lw.clock.now)).toBe(true)
  })

  it('a successful sign-in does not reset the IP failure counter', async () => {
    const { pin } = await newPinUser('driver')
    for (let i = 0; i < 9; i++) await login(WRONG, device(100 + i), IP_A).catch(() => undefined)
    await login(pin, DEV_B, IP_A)
    // The 10th failure from that IP still locks it.
    expect((await refusal(login(WRONG, DEV_B, IP_A))).details).toMatchObject({ retryAfterSeconds: 900 })
  })

  it('applyFailure: pure window and doubling arithmetic', () => {
    let s: AttemptState | undefined
    for (let i = 0; i < 9; i++) s = applyFailure(s, 1000, 10, PIN_LIMITS)
    expect(s).toMatchObject({ failures: 9, lockedUntil: 0 })
    s = applyFailure(s, 1000, 10, PIN_LIMITS)
    expect(s).toMatchObject({ failures: 0, lockouts: 1, lockedUntil: 1000 + 15 * 60_000 })
    // A day later the lockout history is forgotten: back to 15 minutes.
    let t = s
    for (let i = 0; i < 10; i++) t = applyFailure(t, 1000 + 25 * 3_600_000, 10, PIN_LIMITS)
    expect(t?.lockouts).toBe(1)
  })
})

describe('loginWithPin: probe detection (never a global lockout)', () => {
  it('above the platform-wide rate: one security.pin_probe_suspected per window, and nobody else is locked out', async () => {
    const { uid, pin } = await newPinUser('driver')
    lw.deps.limits = { ...PIN_LIMITS, probeFailures: 20 }
    let n = 0
    lw.deps.random = () => (n++ % 10) / 10 + 0.01 // spread over the shards
    for (let i = 0; i < 40; i++) await login(WRONG, device(i), `10.0.${i}.1`).catch(() => undefined)
    expect(lw.probeAlerts.size).toBe(1)
    expect([...lw.probeAlerts.values()][0]).toBeGreaterThanOrEqual(20)
    expect(lw.logs.some((l) => l.includes('pin-probe-suspected'))).toBe(true)
    expect((await login(pin, DEV_B, IP_B)).token).toBe(`token-for-${uid}`)
  })
})

describe('loginWithPin: new security device', () => {
  it('notifies the admins exactly once, even when the sign-in is retried', async () => {
    const { uid, pin } = await newPinUser('security')
    await login(pin)
    await login(pin) // a retry from the same phone
    const sent = [...lw.nw.notifications].filter(([id]) => id.startsWith('newDevice_'))
    expect(sent.map(([, d]) => d.recipientUid).sort()).toEqual(['admin', 'admin2'])
    expect(sent[0]?.[1]).toMatchObject({ type: 'security_new_device', title: 'Security sign-in on a new device', body: 'Sam signed in on a new device', link: '/admin/users' })
    // The same device creates nothing more even if the device record were lost (deterministic id).
    lw.known.delete(uid)
    await login(pin)
    expect([...lw.nw.notifications.keys()].filter((id) => id.startsWith('newDevice_'))).toHaveLength(2)
  })

  it('a second device notifies again; drivers never trigger it', async () => {
    const sec = await newPinUser('security')
    const drv = await newPinUser('driver')
    await login(sec.pin, DEV_A)
    await login(sec.pin, DEV_B)
    await login(drv.pin, DEV_A, IP_B)
    expect([...lw.nw.notifications.keys()].filter((id) => id.startsWith('newDevice_'))).toHaveLength(4)
  })

  it('after a reissue the old PIN stops working and the same phone alerts again', async () => {
    const { uid, pin } = await newPinUser('security')
    await login(pin)
    const { pin: fresh } = await reissuePin(lw.w.deps, admin(), { uid })
    lw.known.delete(uid) // reissuePinTx clears knownDevices (the fake login port keeps its own copy)
    expect((({ elapsed: _e, ...r }) => (void _e, r))(await refusal(login(pin)))).toEqual(GENERIC)
    await login(fresh)
    expect([...lw.nw.notifications.keys()].filter((id) => id.startsWith('newDevice_'))).toHaveLength(4)
  })
})

describe('upsertDevice', () => {
  it('adds, refreshes and caps', () => {
    let devices: Record<string, KnownDevice> | undefined
    for (let i = 0; i < 6; i++) devices = upsertDevice(devices, `d${i}`, i).devices
    expect(Object.keys(devices ?? {})).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'])
    const again = upsertDevice(devices, 'd1', 10)
    expect(again.newDevice).toBe(false)
    expect(again.devices.d1).toEqual({ firstSeenAt: 1, lastSeenAt: 10 })
  })
})
