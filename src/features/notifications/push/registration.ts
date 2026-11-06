import { registerDevice, unregisterDevice } from '@/lib/api'
import { app } from '@/lib/firebase'
import { readPushEnv, type Platform } from './env'
import { getDeviceId, getRefreshedAt, isEnabledFlag, setEnabledFlag, setRefreshedAt } from './storage'

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'unconfigured' | 'error'

const REFRESH_EVERY_MS = 24 * 3_600_000

/** Alerts are on for this browser profile and this account, and the browser still allows them. */
export const isPushEnabledHere = (uid: string): boolean => isEnabledFlag(uid) && readPushEnv().permission === 'granted'

/**
 * Asks for permission (only ever called from a tap), gets the FCM token for the app's single service worker and
 * registers this device with the server. The Firebase messaging SDK loads here, not at startup.
 */
export async function enablePush(uid: string, platform: Platform = readPushEnv().platform): Promise<EnableResult> {
  const env = readPushEnv()
  if (!env.supported) return 'unsupported'
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey) return 'unconfigured'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  try {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) return 'unsupported'
    const registration = await navigator.serviceWorker.ready
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration })
    if (!token) return 'error'
    await registerDevice({ deviceId: getDeviceId(), token, platform })
    setEnabledFlag(uid, true)
    setRefreshedAt(uid, Date.now())
    return 'enabled'
  } catch {
    return 'error'
  }
}

/** Turns alerts off for this device: the token is deleted at FCM and the server forgets the device. */
export async function disablePush(uid: string): Promise<void> {
  setEnabledFlag(uid, false)
  try {
    const { getMessaging, deleteToken, isSupported } = await import('firebase/messaging')
    if (await isSupported()) await deleteToken(getMessaging(app))
  } catch {
    /* the server-side removal below is what stops the alerts */
  }
  await unregisterDevice({ deviceId: getDeviceId() })
}

/** Signing out: this device must not keep receiving that account's alerts. Best effort, never blocks sign-out. */
export async function releaseDeviceOnSignOut(uid: string): Promise<void> {
  if (!isEnabledFlag(uid)) return
  setEnabledFlag(uid, false)
  try {
    await Promise.race([unregisterDevice({ deviceId: getDeviceId() }), new Promise((resolve) => setTimeout(resolve, 1500))])
  } catch {
    /* offline: the server also drops a token that moves to another account */
  }
}

/** Tokens rotate: once a day, quietly re-register so the server holds a working one (no prompt, permission is already granted). */
export async function refreshPushRegistration(uid: string): Promise<void> {
  if (!isPushEnabledHere(uid) || Date.now() - getRefreshedAt(uid) < REFRESH_EVERY_MS) return
  await enablePush(uid)
}
