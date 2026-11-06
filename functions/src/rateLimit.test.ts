import { describe, expect, it } from 'vitest'
import { enforceRateLimit, evaluateWindow, type RateLimitPort, type WindowState } from './rateLimit.js'
import { rejects } from './test-utils.js'

const memoryPort = (): RateLimitPort & { docs: Map<string, WindowState & { expireAt: number }> } => {
  const docs = new Map<string, WindowState & { expireAt: number }>()
  return {
    docs,
    update: async (key, apply, expireAtMs) => {
      const prev = docs.get(key)
      const next = apply(prev)
      if (next !== prev) docs.set(key, { ...next, expireAt: expireAtMs(next) })
    },
  }
}
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % 60_000) // a minute boundary

describe('rate limiter', () => {
  it('allows 30 calls in a window and rejects the 31st with resource-exhausted', async () => {
    const port = memoryPort()
    for (let i = 0; i < 30; i++) await enforceRateLimit(port, 'u1', 'createUser', T0 + i * 1000)
    await rejects(enforceRateLimit(port, 'u1', 'createUser', T0 + 31_000), 'resource-exhausted', 'rate-limited')
  })
  it('starts a fresh window after the minute is over', async () => {
    const port = memoryPort()
    for (let i = 0; i < 30; i++) await enforceRateLimit(port, 'u1', 'createUser', T0)
    await rejects(enforceRateLimit(port, 'u1', 'createUser', T0 + 59_999), 'resource-exhausted')
    await enforceRateLimit(port, 'u1', 'createUser', T0 + 60_000)
    expect(port.docs.get('u1_createUser')).toMatchObject({ windowStart: T0 + 60_000, count: 1 })
  })
  it('one user (or one function) does not affect another', async () => {
    const port = memoryPort()
    for (let i = 0; i < 30; i++) await enforceRateLimit(port, 'u1', 'createUser', T0)
    await rejects(enforceRateLimit(port, 'u1', 'createUser', T0), 'resource-exhausted')
    await enforceRateLimit(port, 'u2', 'createUser', T0)
    await enforceRateLimit(port, 'u1', 'resetCredential', T0)
  })
  it('honours a configured limit and keeps one doc per user and function, with an expiry for TTL cleanup', async () => {
    const port = memoryPort()
    const opts = { limit: 2, windowMs: 1000 }
    await enforceRateLimit(port, 'u1', 'f', T0, opts)
    await enforceRateLimit(port, 'u1', 'f', T0 + 1, opts)
    await rejects(enforceRateLimit(port, 'u1', 'f', T0 + 2, opts), 'resource-exhausted')
    await enforceRateLimit(port, 'u1', 'f', T0 + 5000, opts)
    expect(port.docs.size).toBe(1)
    expect(port.docs.get('u1_f')?.expireAt).toBe(T0 + 5000 + 2000)
  })
  it('evaluateWindow is pure', () => {
    expect(evaluateWindow(undefined, T0, { limit: 1, windowMs: 60_000 }).next).toEqual({ windowStart: T0, count: 1 })
  })
})
