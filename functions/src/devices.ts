import { z } from 'zod'
import { parse, requireActiveCaller, type Deps } from './core.js'
import { MAX_DEVICES_PER_USER } from './notifications.js'
import type { Caller } from './types.js'

export const PLATFORMS = ['android', 'ios', 'desktop', 'other'] as const
export const MAX_USER_AGENT = 120

export const registerDeviceSchema = z.object({
  /** Random id the browser keeps in localStorage; one doc per browser profile. */
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  token: z.string().min(20).max(4096),
  platform: z.enum(PLATFORMS),
})
export const unregisterDeviceSchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) })

export interface DeviceInput {
  token: string
  platform: (typeof PLATFORMS)[number]
  userAgent: string
  nowMs: number
}

export interface DevicePort {
  /**
   * Transaction on `users/{uid}/devices`: create or update `deviceId` (createdAt only on create), drop other docs of
   * this user that hold the same token, and when the user then has more than `max` devices delete the oldest.
   * Afterwards (best effort) removes the same token from every other user's devices (a shared phone).
   */
  upsertDevice(uid: string, deviceId: string, input: DeviceInput, max: number): Promise<void>
  deleteDevice(uid: string, deviceId: string): Promise<void>
}

export interface CallMeta {
  userAgent: string | undefined
}

/** Caller only: the uid and tenant come from the token, never from the payload. */
export async function registerDevice(deps: Deps, devices: DevicePort, caller: Caller, raw: unknown, meta: CallMeta): Promise<{ ok: true }> {
  const input = parse(registerDeviceSchema, raw)
  await requireActiveCaller(deps, caller)
  await devices.upsertDevice(
    caller.uid,
    input.deviceId,
    { token: input.token, platform: input.platform, userAgent: (meta.userAgent ?? '').slice(0, MAX_USER_AGENT), nowMs: deps.now() * 1000 },
    MAX_DEVICES_PER_USER,
  )
  return { ok: true }
}

export async function unregisterDevice(deps: Deps, devices: DevicePort, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(unregisterDeviceSchema, raw)
  // No active check: a user who is signing out (or was just disabled) must still be able to remove their device.
  void deps
  await devices.deleteDevice(caller.uid, input.deviceId)
  return { ok: true }
}
