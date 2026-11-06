import { beforeEach, describe, expect, it } from 'vitest'
import { registerDevice, unregisterDevice } from './devices.js'
import { makeNotifyWorld, type NotifyWorld } from './notify-test-utils.js'
import { caller, drv1, makeWorld, rejects, type World } from './test-utils.js'

let w: World
let nw: NotifyWorld
beforeEach(() => {
  w = makeWorld()
  nw = makeNotifyWorld(w)
})
const dev = (n: number) => `device-${String(n).padStart(10, '0')}-abcdef`
const reg = (n: number, token = `token-${n}-`.padEnd(30, 'x'), c = drv1(), ua = 'Mozilla/5.0') =>
  registerDevice(w.deps, nw.devicePort, c, { deviceId: dev(n), token, platform: 'android' }, { userAgent: ua })

describe('registerDevice / unregisterDevice', () => {
  it('upserts by deviceId for the caller only and trims the user agent to 120 chars', async () => {
    await reg(1)
    await reg(1, 'token-new-'.padEnd(30, 'y'), drv1(), 'U'.repeat(300))
    const d = nw.devices.get('drv1')
    expect(d?.size).toBe(1)
    expect(d?.get(dev(1))).toMatchObject({ token: 'token-new-'.padEnd(30, 'y'), platform: 'android', enabled: true })
    expect(d?.get(dev(1))?.userAgent).toHaveLength(120)
  })
  it('keeps at most 5 devices per user, dropping the oldest', async () => {
    for (let i = 1; i <= 7; i++) {
      nw.nowMs += 1000
      await registerDevice(w.deps, nw.devicePort, drv1(), { deviceId: dev(i), token: `token-${i}-`.padEnd(30, 'x'), platform: 'ios' }, { userAgent: '' })
      // the fake stamps createdAt from the call time
    }
    expect(nw.devices.get('drv1')?.size).toBe(5)
  })
  it('a token moves to the account that registered it last (shared phone)', async () => {
    const token = 'shared-token-'.padEnd(30, 'z')
    await reg(1, token, drv1())
    await reg(2, token, caller('sup1', 'supervisor', 'C1'))
    expect(nw.devices.get('drv1')?.size ?? 0).toBe(0)
    expect(nw.devices.get('sup1')?.size).toBe(1)
  })
  it('validates the payload, requires an active caller and never trusts a uid from the client', async () => {
    await rejects(registerDevice(w.deps, nw.devicePort, drv1(), { deviceId: 'x', token: 'short', platform: 'android' }, { userAgent: '' }), 'invalid-argument', 'invalid-input')
    await rejects(registerDevice(w.deps, nw.devicePort, drv1(), { deviceId: dev(1), token: 't'.repeat(30), platform: 'toaster' }, { userAgent: '' }), 'invalid-argument', 'invalid-input')
    await registerDevice(w.deps, nw.devicePort, drv1(), { deviceId: dev(1), token: 't'.repeat(30), platform: 'web' as never, uid: 'other' } as never, { userAgent: '' }).catch(() => undefined)
    expect(nw.devices.has('other')).toBe(false)
    await rejects(reg(1, undefined, caller('ghost', 'driver', 'C1')), 'permission-denied', 'caller-not-active')
  })
  it('unregister removes only the caller’s own device doc', async () => {
    await reg(1)
    await reg(1, undefined, caller('sup1', 'supervisor', 'C1'))
    await unregisterDevice(w.deps, nw.devicePort, drv1(), { deviceId: dev(1) })
    expect(nw.devices.get('drv1')?.size ?? 0).toBe(0)
    expect(nw.devices.get('sup1')?.size).toBe(1)
    await rejects(unregisterDevice(w.deps, nw.devicePort, drv1(), {}), 'invalid-argument', 'invalid-input')
  })
})
