import { app } from '@/lib/firebase'
import { isPushEnabledHere, refreshPushRegistration } from './registration'

export interface ForegroundMessage {
  title: string
  body: string
  link: string
}

const none = () => undefined

/** Messages that arrive while the app is open: handed to the app (a toast) instead of drawn as a system notification. */
export async function subscribeForegroundPush(uid: string, handler: (m: ForegroundMessage) => void): Promise<() => void> {
  if (!isPushEnabledHere(uid)) return none
  // Tokens rotate: once a day, quietly re-register so the server keeps a working one.
  void refreshPushRegistration(uid).catch(() => undefined)
  try {
    const { getMessaging, isSupported, onMessage } = await import('firebase/messaging')
    if (!(await isSupported())) return none
    return onMessage(getMessaging(app), (payload) =>
      handler({ title: payload.data?.title ?? '', body: payload.data?.body ?? '', link: payload.data?.link ?? '' }),
    )
  } catch {
    return none
  }
}
