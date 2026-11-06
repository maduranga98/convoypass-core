// Per-device convenience state. Nothing here is trusted for access: the server owns the device list.
const DEVICE_KEY = 'convoypass.deviceId'
const enabledKey = (uid: string) => `convoypass.push.enabled.${uid}`
const dismissedKey = (uid: string) => `convoypass.push.dismissed.${uid}`
const refreshedKey = (uid: string) => `convoypass.push.refreshed.${uid}`

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode or blocked storage: the card simply shows again next time */
  }
}

const randomId = (): string => {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32).padEnd(16, '0')
}

/** One random id per browser profile (the server upserts the device doc by it). */
export function getDeviceId(): string {
  const existing = read(DEVICE_KEY)
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing
  const id = randomId()
  write(DEVICE_KEY, id)
  return id
}

export const isEnabledFlag = (uid: string): boolean => read(enabledKey(uid)) === '1'
export const setEnabledFlag = (uid: string, on: boolean): void => write(enabledKey(uid), on ? '1' : null)

export function getDismissedAt(uid: string): number | null {
  const n = Number(read(dismissedKey(uid)))
  return Number.isFinite(n) && n > 0 ? n : null
}
export const setDismissedAt = (uid: string, at: number): void => write(dismissedKey(uid), String(at))

export const getRefreshedAt = (uid: string): number => Number(read(refreshedKey(uid))) || 0
export const setRefreshedAt = (uid: string, at: number): void => write(refreshedKey(uid), String(at))
