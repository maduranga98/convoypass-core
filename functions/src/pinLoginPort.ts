import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { AttemptState, KnownDevice, PinLoginPort } from './pinLogin.js'
import { upsertDevice } from './pinLogin.js'
import { platformAudit } from './platform/platformAudit.js'
import type { ContractorData, PinIndexEntry, UserData } from './types.js'
import { PROBE_SHARDS } from './pinLogin.js'

const ALREADY_EXISTS = 6
/** `pinAttempts` documents carry `expireAt` for the Firestore TTL policy (docs/ops.md). */
const ATTEMPT_TTL_MS = 48 * 3_600_000

const millis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const toAttempt = (d: FirebaseFirestore.DocumentData | undefined): AttemptState | undefined =>
  d
    ? {
        windowStart: millis(d.windowStart),
        failures: Number(d.failures ?? 0),
        lockedUntil: millis(d.lockedUntil),
        lockouts: Number(d.lockouts ?? 0),
        lastLockoutAt: millis(d.lastLockoutAt),
      }
    : undefined

const fromAttempt = (s: AttemptState) => ({
  windowStart: Timestamp.fromMillis(s.windowStart),
  failures: s.failures,
  lockedUntil: Timestamp.fromMillis(s.lockedUntil),
  lockouts: s.lockouts,
  lastLockoutAt: Timestamp.fromMillis(s.lastLockoutAt),
  expireAt: Timestamp.fromMillis(Math.max(s.lockedUntil, s.windowStart) + ATTEMPT_TTL_MS),
})

export const pinLoginPort = (): PinLoginPort => {
  const db = getFirestore()
  const auth = getAuth()
  return {
    getAttempts: async (keys) => {
      const snaps = await db.getAll(...keys.map((k) => db.doc(`pinAttempts/${k}`)))
      const out = new Map<string, AttemptState>()
      for (const s of snaps) {
        const a = toAttempt(s.data())
        if (a) out.set(s.id, a)
      }
      return out
    },
    updateAttempts: (key, apply) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`pinAttempts/${key}`)
        const next = apply(toAttempt((await tx.get(ref)).data()))
        tx.set(ref, fromAttempt(next))
      }),
    incrementProbe: (windowStart, shard) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`pinAttempts/probe-${windowStart}-${shard}`)
        const count = Number((await tx.get(ref)).data()?.failures ?? 0) + 1
        tx.set(ref, { failures: count, windowStart: Timestamp.fromMillis(windowStart), expireAt: Timestamp.fromMillis(windowStart + ATTEMPT_TTL_MS) })
        return count
      }),
    sumProbe: async (windowStart) => {
      const snaps = await db.getAll(...Array.from({ length: PROBE_SHARDS }, (_, i) => db.doc(`pinAttempts/probe-${windowStart}-${i}`)))
      return snaps.reduce((n, s) => n + Number(s.data()?.failures ?? 0), 0)
    },
    recordProbe: async (windowStart, failures) => {
      try {
        const entry = platformAudit('system', 'security.pin_probe_suspected', new Date(windowStart).toISOString(), { failures })
        await db.doc(`platformAuditLog/pinprobe_${windowStart}`).create({ ...entry, createdAt: FieldValue.serverTimestamp() })
        return true
      } catch (e) {
        if ((e as { code?: unknown }).code === ALREADY_EXISTS) return false
        throw e
      }
    },
    getPinEntry: async (key) => {
      const snap = await db.doc(`pinIndex/${key}`).get()
      return snap.exists ? (snap.data() as PinIndexEntry) : null
    },
    getUser: async (uid) => {
      const snap = await db.doc(`users/${uid}`).get()
      return snap.exists ? (snap.data() as UserData) : null
    },
    getContractor: async (id) => {
      const snap = await db.doc(`contractors/${id}`).get()
      return snap.exists ? (snap.data() as ContractorData) : null
    },
    getTenant: async (id) => {
      const snap = await db.doc(`tenants/${id}`).get()
      return snap.exists ? (snap.data() as { status?: string }) : null
    },
    getAuthUser: async (uid) => {
      try {
        return { disabled: (await auth.getUser(uid)).disabled }
      } catch (e) {
        if ((e as { code?: unknown }).code === 'auth/user-not-found') return null
        throw e
      }
    },
    createCustomToken: (uid) => auth.createCustomToken(uid),
    recordLogin: ({ uid, deviceKey, nowMs, audit }) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`users/${uid}`)
        const raw = (await tx.get(ref)).data()?.knownDevices as Record<string, { firstSeenAt?: unknown; lastSeenAt?: unknown }> | undefined
        const current: Record<string, KnownDevice> = Object.fromEntries(
          Object.entries(raw ?? {}).map(([k, v]) => [k, { firstSeenAt: millis(v.firstSeenAt), lastSeenAt: millis(v.lastSeenAt) }]),
        )
        const { devices, newDevice } = upsertDevice(current, deviceKey, nowMs)
        tx.update(ref, {
          lastLoginAt: Timestamp.fromMillis(nowMs),
          // Replaced as a whole map so dropped devices disappear.
          knownDevices: Object.fromEntries(
            Object.entries(devices).map(([k, v]) => [k, { firstSeenAt: Timestamp.fromMillis(v.firstSeenAt), lastSeenAt: Timestamp.fromMillis(v.lastSeenAt) }]),
          ),
        })
        tx.create(db.collection('auditLog').doc(), { ...audit(newDevice), createdAt: FieldValue.serverTimestamp() })
        return { newDevice }
      }),
  }
}
