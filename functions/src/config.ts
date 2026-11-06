/** Region for all callables. Keep in sync with VITE_FUNCTIONS_REGION in the web app. */
export const REGION = process.env.FUNCTIONS_REGION || 'asia-south1'

const intFromEnv = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** True inside the Functions emulator (it sets FUNCTIONS_EMULATOR=true). */
export const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true'

/**
 * Open super admin signup (`signUpSuperAdmin`, the /platform/signup page). Always on in the emulator; anywhere else it needs
 * `ALLOW_SUPERADMIN_SIGNUP=true` in functions/.env.<alias>. While on, ANYONE who finds the page can become a super admin
 * (create workspaces and admins for every client): leave it off in production, or turn it off again after creating yours.
 */
export const SUPERADMIN_SIGNUP_ENABLED = IN_EMULATOR || process.env.ALLOW_SUPERADMIN_SIGNUP === 'true'

/**
 * App Check enforcement for callables. Off unless `ENFORCE_APP_CHECK=true` (functions/.env.<alias>), and never in
 * the emulator. Roll out in monitoring mode first: see docs/ops.md.
 */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true' && !IN_EMULATOR

/**
 * Warm instances for the latency-sensitive gate callables (`checkIn`, `resolveVehicle`, `submitPass`).
 * Default 0 (staging); production sets MIN_INSTANCES=1 in functions/.env.prod. Costs money: see docs/ops.md.
 */
export const MIN_INSTANCES = intFromEnv(process.env.MIN_INSTANCES, 0, 0, 10)

/** Default per-user rate limit for sensitive callables: calls per window. */
export const RATE_LIMIT_CALLS = intFromEnv(process.env.RATE_LIMIT_CALLS, 30, 1, 10_000)
export const RATE_LIMIT_WINDOW_SECONDS = intFromEnv(process.env.RATE_LIMIT_WINDOW_SECONDS, 60, 1, 3600)

/** Public origin of the web app (https), used for push links. Empty = push messages carry no absolute link. */
export const APP_BASE_URL = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * PIN sign-in throttling (Module 12). Per hashed IP and per hashed device, fixed windows; a lockout doubles for repeat
 * lockouts up to the maximum. The env values (functions/.env.<alias>) can only make the limits STRICTER than these
 * defaults (fewer failures, longer locks): a loosened limit is clamped back. There is deliberately no global lockout.
 */
export const PIN_LIMITS = {
  ipFailures: intFromEnv(process.env.PIN_IP_FAILURES, 10, 3, 10),
  deviceFailures: intFromEnv(process.env.PIN_DEVICE_FAILURES, 8, 3, 8),
  windowMs: intFromEnv(process.env.PIN_WINDOW_MINUTES, 15, 15, 24 * 60) * 60_000,
  lockMs: intFromEnv(process.env.PIN_LOCK_MINUTES, 15, 15, 24 * 60) * 60_000,
  maxLockMs: intFromEnv(process.env.PIN_LOCK_MAX_MINUTES, 120, 120, 7 * 24 * 60) * 60_000,
  /** A lockout older than this no longer counts toward doubling. */
  lockoutMemoryMs: 24 * 3_600_000,
  /** Platform-wide failures in one window that raise `security.pin_probe_suspected` (an alert, never a lockout). */
  probeFailures: intFromEnv(process.env.PIN_PROBE_FAILURES, 200, 10, 1_000_000),
  probeWindowMs: intFromEnv(process.env.PIN_PROBE_WINDOW_MINUTES, 5, 1, 60) * 60_000,
  /** Every failure answers after at least this long, plus up to `jitterMs`. */
  minDelayMs: 400,
  jitterMs: 150,
} as const
export type PinLimits = typeof PIN_LIMITS
