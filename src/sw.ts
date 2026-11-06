/// <reference lib="webworker" />
// The one service worker (vite-plugin-pwa, injectManifest): app-shell precache, Firebase background messages and
// notification clicks. Do not register another one: FCM is pointed at this registration (see push/registration.ts).
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// SPA: every navigation gets the cached shell, except files and Firebase's reserved paths.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//, /\/[^/?]+\.[^/]+$/] }))

// A new version waits until the page says it is a good moment (see pwa/register.ts): never mid camera capture.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

/** Messages are data-only (the server sends no `notification` block), so this is the only place one is drawn. */
onBackgroundMessage(getMessaging(app), (payload) => {
  const data = payload.data ?? {}
  const title = data.title || 'ConvoyPass'
  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body ?? '',
    icon: '/android-chrome-192x192.png',
    badge: '/icons/badge-96.png',
    // A stable tag replaces the previous notification; renotify makes the replacement alert again.
    ...(data.tag ? { tag: data.tag, renotify: data.renotify === '1' } : {}),
    data: { link: data.link || '/' },
  }
  return self.registration.showNotification(title, options)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = typeof event.notification.data?.link === 'string' ? (event.notification.data.link as string) : '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin) as WindowClient | undefined
      if (existing) {
        await existing.focus()
        // The app navigates itself (no reload, so an open form survives); see App.tsx.
        existing.postMessage({ type: 'convoypass:navigate', link })
        return
      }
      await self.clients.openWindow(new URL(link, self.location.origin).href)
    })(),
  )
})
