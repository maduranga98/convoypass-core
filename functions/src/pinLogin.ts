// `loginWithPin` (Module 12): drivers and security type one 8-digit PIN; the server finds who they are and returns a
// custom token. Unauthenticated, so it is throttled per hashed IP and per hashed device BEFORE any lookup, and every
// failure (wrong, unknown, suspended, disabled, malformed, throttled) looks the same: one error, one message, after the
// same minimum delay. The PIN is never stored, logged or returned; only HMACs under PIN_PEPPER are.
// Pure apart from the ports: `pinLoginPort.ts` implements them with the Admin SDK, the tests with fakes.
import { HttpsError } from 'firebase-functions/v2/https'
import type { PinLimits } from './config.js'
import { audit, parse } from './core.js'
import { fail, failWith } from './errors.js'
import { logError, logInfo, logWarn } from './logger.js'
import type { PlannedNotification } from './notifications.js'
import { templates } from './notificationTemplates.js'
import { assertPepper, identifierKey, normalisePin, pinKey } from './pin.js'
import { loginWithPinSchema } from './schemas.js'
import { isPinRole } from './session.js'
import type { AuditEntry, ContractorData, PinIndexEntry, UserData } from './types.js'

/** The one message every failed sign-in gets. */
export const PIN_FAILURE_MESSAGE = "That PIN didn't work. Check it or ask your supervisor."
export const MAX_KNOWN_DEVICES = 5
export const PROBE_SHARDS = 10

/** `pinAttempts/{key}`: one fixed-window counter per hashed IP or device. Times are milliseconds. */
export interface AttemptState {
  windowStart: number
  failures: number
  lockedUntil: number
  /** Lockouts in a row (resets after `lockoutMemoryMs` without one); each doubles the next lock. */
  lockouts: number
  lastLockoutAt: number
}

export interface KnownDevice {
  firstSeenAt: number
  lastSeenAt: number
}

export interface PinLoginPort {
  getAttempts(keys: string[]): Promise<Map<string, AttemptState>>
  /** Atomic read-modify-write of `pinAttempts/{key}` (a transaction in production). */
  updateAttempts(key: string, apply: (prev: AttemptState | undefined) => AttemptState): Promise<void>
  /** Adds one failure to a shard of the platform-wide counter for the window; returns that shard's new count. */
  incrementProbe(windowStart: number, shard: number): Promise<number>
  /** Sum of every shard of the window. */
  sumProbe(windowStart: number): Promise<number>
  /** Creates `platformAuditLog/pinprobe_{windowStart}` once; false when it already exists. */
  recordProbe(windowStart: number, failures: number): Promise<boolean>
  getPinEntry(key: string): Promise<PinIndexEntry | null>
  getUser(uid: string): Promise<UserData | null>
  getContractor(id: string): Promise<ContractorData | null>
  getTenant(id: string): Promise<{ status?: string } | null>
  getAuthUser(uid: string): Promise<{ disabled: boolean } | null>
  createCustomToken(uid: string): Promise<string>
  /**
   * One transaction on `users/{uid}`: sets `lastLoginAt`, adds or refreshes `knownDevices[deviceKey]` (at most
   * MAX_KNOWN_DEVICES, the least recently seen dropped) and writes the audit entry. Returns whether the device was new.
   */
  recordLogin(p: { uid: string; deviceKey: string; nowMs: number; audit: (newDevice: boolean) => AuditEntry }): Promise<{ newDevice: boolean }>
}

export interface PinLoginDeps {
  port: PinLoginPort
  limits: PinLimits
  pepper: () => string | undefined
  /** Milliseconds. */
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** [0, 1) */
  random: () => number
  /** Delivers an in-app notification (+ push) to the tenant's admins. Errors are logged, never fail the sign-in. */
  notify: (tenantId: string, planned: PlannedNotification, actorUid: string) => Promise<void>
}

// ---- Throttling (pure) ---------------------------------------------------------------------

export const lockRemainingMs = (s: AttemptState | undefined, nowMs: number): number =>
  s && s.lockedUntil > nowMs ? s.lockedUntil - nowMs : 0

/** One more failure. The `limit`th failure in a window locks for `lockMs`, doubled per repeat lockout up to `maxLockMs`. */
export function applyFailure(prev: AttemptState | undefined, nowMs: number, limit: number, l: PinLimits): AttemptState {
  const base = prev ?? { windowStart: nowMs, failures: 0, lockedUntil: 0, lockouts: 0, lastLockoutAt: 0 }
  const lockouts = base.lastLockoutAt > 0 && nowMs - base.lastLockoutAt > l.lockoutMemoryMs ? 0 : base.lockouts
  const fresh = nowMs - base.windowStart >= l.windowMs
  const windowStart = fresh ? nowMs : base.windowStart
  const failures = (fresh ? 0 : base.failures) + 1
  if (failures >= limit) {
    const n = lockouts + 1
    return { windowStart: nowMs, failures: 0, lockedUntil: nowMs + Math.min(l.lockMs * 2 ** (n - 1), l.maxLockMs), lockouts: n, lastLockoutAt: nowMs }
  }
  return { windowStart, failures, lockedUntil: base.lockedUntil, lockouts, lastLockoutAt: base.lastLockoutAt }
}

/** Least recently seen first out, so at most `max` devices remain (the current one always stays). */
export function upsertDevice(
  devices: Record<string, KnownDevice> | undefined,
  key: string,
  nowMs: number,
  max = MAX_KNOWN_DEVICES,
): { devices: Record<string, KnownDevice>; newDevice: boolean } {
  const current = devices ?? {}
  const existing = current[key]
  const next: Record<string, KnownDevice> = { ...current, [key]: { firstSeenAt: existing?.firstSeenAt ?? nowMs, lastSeenAt: nowMs } }
  const keys = Object.keys(next).sort((a, b) => (next[a] as KnownDevice).lastSeenAt - (next[b] as KnownDevice).lastSeenAt)
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) if (k !== key) delete next[k]
  return { devices: next, newDevice: !existing }
}

// ---- loginWithPin --------------------------------------------------------------------------

const failure = (): HttpsError => fail('unauthenticated', 'pin-invalid', PIN_FAILURE_MESSAGE)
const throttled = (ms: number): HttpsError =>
  failWith('unauthenticated', 'pin-invalid', PIN_FAILURE_MESSAGE, { retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) })

/** Thrown inside `attempt` for a wrong or unusable PIN: counted, then answered with the generic error. */
class CountedFailure extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Throttle first (a locked IP or device never reaches the lookup), then: PIN format, `pinIndex/{hmac}`, the user (active,
 * same tenant and role, a PIN role), the contractor (drivers: active), the tenant (not suspended), the Auth user (not
 * disabled). Success mints a custom token (the user's custom claims stay the source of truth) and records the device.
 */
export async function loginWithPin(deps: PinLoginDeps, raw: unknown, ip: string | undefined): Promise<{ token: string }> {
  const started = deps.now()
  const answerAt = started + deps.limits.minDelayMs + Math.floor(deps.random() * (deps.limits.jitterMs + 1))
  try {
    return await attempt(deps, raw, ip)
  } catch (e) {
    let refusal = e instanceof HttpsError ? e : failure()
    if (!(e instanceof HttpsError)) logError({ fn: 'loginWithPin' }, e)
    // Only the two shapes this function means to give leave it: never a typed reason from a helper.
    const reason = (refusal.details as { reason?: unknown } | undefined)?.reason
    if (reason !== 'pin-invalid') refusal = failure()
    const retry = (refusal.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds
    // One line, nothing from the payload: no PIN, no device id, no IP.
    logWarn({ fn: 'loginWithPin' }, retry === undefined ? 'denied' : 'rate-limited', { reason: 'pin-invalid' })
    const wait = answerAt - deps.now()
    if (wait > 0) await deps.sleep(wait)
    throw refusal
  }
}

async function attempt(deps: PinLoginDeps, raw: unknown, ip: string | undefined): Promise<{ token: string }> {
  const { port } = deps
  let pepper: string
  try {
    pepper = assertPepper(deps.pepper())
  } catch (e) {
    logError({ fn: 'loginWithPin' }, e, { reason: 'config-missing' })
    throw failure()
  }

  const ipKey = `ip-${identifierKey('ip', ip?.trim() || 'unknown', pepper)}`
  const rawDevice = typeof raw === 'object' && raw !== null ? (raw as { deviceId?: unknown }).deviceId : undefined
  const deviceId = typeof rawDevice === 'string' && UUID.test(rawDevice) ? rawDevice.toLowerCase() : null
  const deviceHash = deviceId ? identifierKey('dev', deviceId, pepper) : null
  const devKey = deviceHash ? `dev-${deviceHash}` : null
  const keys = devKey ? [ipKey, devKey] : [ipKey]

  const nowMs = deps.now()
  const states = await port.getAttempts(keys)
  const locked = Math.max(...keys.map((k) => lockRemainingMs(states.get(k), nowMs)))
  if (locked > 0) throw throttled(locked)

  try {
    const input = (() => {
      try {
        return parse(loginWithPinSchema, raw)
      } catch {
        throw new CountedFailure()
      }
    })()
    const pin = normalisePin(input.pin)
    if (!pin || !deviceHash) throw new CountedFailure()

    const entry = await port.getPinEntry(pinKey(pin, pepper))
    if (!entry) throw new CountedFailure()
    const user = await port.getUser(entry.uid)
    if (!user || user.status !== 'active' || user.tenantId !== entry.tenantId || user.role !== entry.role || !isPinRole(user.role)) {
      throw new CountedFailure()
    }
    if (user.role === 'driver') {
      const contractor = user.contractorId ? await port.getContractor(user.contractorId) : null
      if (!contractor || contractor.tenantId !== user.tenantId || contractor.status !== 'active') throw new CountedFailure()
    }
    const tenant = await port.getTenant(user.tenantId)
    if (!tenant || tenant.status === 'suspended') throw new CountedFailure()
    const authUser = await port.getAuthUser(entry.uid)
    if (!authUser || authUser.disabled) throw new CountedFailure()

    const token = await port.createCustomToken(entry.uid)
    const caller = { uid: entry.uid, role: user.role, tenantId: user.tenantId, contractorId: user.contractorId, authTime: Math.floor(nowMs / 1000) }
    const { newDevice } = await port.recordLogin({
      uid: entry.uid,
      deviceKey: deviceHash,
      nowMs,
      // The device id is hashed (and shortened); no IP, no PIN.
      audit: (isNew) => audit(caller, 'auth.pin_login', entry.uid, { device: deviceHash.slice(0, 12), newDevice: isNew }),
    })
    // A successful sign-in clears this device's failures; the IP counter is left alone (carrier IPs are shared).
    if (devKey && (states.get(devKey)?.failures ?? 0) > 0) {
      await port.updateAttempts(devKey, (prev) => ({ ...(prev as AttemptState), failures: 0, windowStart: nowMs })).catch(() => undefined)
    }

    if (newDevice && user.role === 'security') {
      const planned: PlannedNotification = {
        event: 'newDevice',
        sourceId: `${entry.uid}-${deviceHash.slice(0, 16)}`,
        // A reissued PIN (new pinVersion) clears the device list, so the same phone can alert again.
        attempt: user.pinVersion ?? 1,
        type: 'security_new_device',
        to: [{ kind: 'admins' }],
        text: templates.securityNewDevice({ name: user.name }),
        link: () => '/admin/users',
      }
      await deps.notify(user.tenantId, planned, entry.uid).catch((e: unknown) => logError({ fn: 'loginWithPin', uid: entry.uid, tenantId: user.tenantId }, e))
    }
    logInfo({ fn: 'loginWithPin', uid: entry.uid, tenantId: user.tenantId }, 'ok', { newDevice })
    return { token }
  } catch (e) {
    if (!(e instanceof CountedFailure)) throw e
    throw await countFailure(deps, keys, devKey, nowMs)
  }
}

/** Counts one failure against the IP and the device (and the platform-wide probe counter); returns the refusal to give. */
async function countFailure(deps: PinLoginDeps, keys: string[], devKey: string | null, nowMs: number): Promise<HttpsError> {
  const { port, limits } = deps
  let lockedFor = 0
  await Promise.all(
    keys.map((key) =>
      port.updateAttempts(key, (prev) => {
        const next = applyFailure(prev, nowMs, key === devKey ? limits.deviceFailures : limits.ipFailures, limits)
        lockedFor = Math.max(lockedFor, lockRemainingMs(next, nowMs))
        return next
      }),
    ),
  )
  await watchForProbe(deps, nowMs).catch((e: unknown) => logError({ fn: 'loginWithPin' }, e, { reason: 'probe-counter' }))
  return lockedFor > 0 ? throttled(lockedFor) : failure()
}

/**
 * Platform-wide failure rate: a sharded counter per window (no hot document). Above the threshold, ONE
 * `security.pin_probe_suspected` entry per window in `platformAuditLog` and one structured error line for alerting.
 * Nobody is locked out by it: that would let an attacker lock out every driver and guard at once.
 */
async function watchForProbe(deps: PinLoginDeps, nowMs: number): Promise<void> {
  const { port, limits } = deps
  const windowStart = Math.floor(nowMs / limits.probeWindowMs) * limits.probeWindowMs
  const shardCount = await port.incrementProbe(windowStart, Math.floor(deps.random() * PROBE_SHARDS))
  // Shards fill evenly: only sum them (10 reads) once this one suggests the total is near the threshold.
  if (shardCount * PROBE_SHARDS < limits.probeFailures / 2) return
  const total = await port.sumProbe(windowStart)
  if (total < limits.probeFailures) return
  if (await port.recordProbe(windowStart, total)) {
    logError({ fn: 'loginWithPin' }, new Error('security.pin_probe_suspected'), {
      reason: 'pin-probe-suspected',
      failures: total,
      windowStart: new Date(windowStart).toISOString(),
    })
  }
}
