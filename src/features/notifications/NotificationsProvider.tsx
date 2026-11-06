import { collection, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, doc, where, writeBatch } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useSession } from '@/features/auth/useAuth'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import { subscribeForegroundPush } from './push/foreground'
import { FEED_LIMIT, FeedContext, type NotificationFeed } from './feedContext'
import { safeLink, toNotification, type AppNotification } from './types'

/** `(3) ConvoyPass` while 3 notifications are unread. One owner of the title for the whole app. */
function useUnreadTitle(unread: number) {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${strings.app.name}` : strings.app.name
    return () => {
      document.title = strings.app.name
    }
  }, [unread])
}

/**
 * One live listener (last 50, newest first) shared by the bell, the page and the tab title; it ends with the
 * session. Also handles messages that arrive while the app is open (a toast, no system notification) and the
 * service worker asking the open window to navigate when a notification is tapped.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { uid, claims } = useSession()
  const navigate = useNavigate()
  const feedKey = `${claims.tenantId}/${uid}`
  const [loaded, setLoaded] = useState<{ key: string; status: NotificationFeed['status']; items: AppNotification[] } | null>(null)
  // A different account (or tenant) starts again from loading: nothing of the previous feed is shown.
  const state = loaded?.key === feedKey ? loaded : { key: feedKey, status: 'loading' as const, items: [] as AppNotification[] }

  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'notifications'),
        // The rules require both: tenant and recipient.
        where('tenantId', '==', claims.tenantId),
        where('recipientUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(FEED_LIMIT),
      ),
      (snap) => setLoaded({ key: feedKey, status: 'ready', items: snap.docs.map((d) => toNotification(d.id, d.data())) }),
      () => setLoaded((s) => ({ key: feedKey, items: s?.key === feedKey ? s.items : [], status: 'error' })),
    )
  }, [uid, claims.tenantId, feedKey])

  const markRead = useCallback(async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { readAt: serverTimestamp() })
  }, [])

  const markAllRead = useCallback(async () => {
    const unread = state.items.filter((n) => !n.readAt).slice(0, FEED_LIMIT)
    if (unread.length === 0) return
    const batch = writeBatch(db)
    for (const n of unread) batch.update(doc(db, 'notifications', n.id), { readAt: serverTimestamp() })
    await batch.commit()
  }, [state.items])

  // Foreground push: the listener already shows the new item in the bell; add a toast.
  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false
    void subscribeForegroundPush(uid, (m) => {
      toast(m.title, {
        description: m.body,
        action: m.link ? { label: strings.notifications.seeAll, onClick: () => void navigate(safeLink(m.link)) } : undefined,
      })
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe()
      else off = unsubscribe
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [uid, navigate])

  // A tapped system notification focuses this window and asks it to navigate (no reload, so an open form survives).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; link?: unknown } | null
      if (data?.type === 'convoypass:navigate' && typeof data.link === 'string') void navigate(safeLink(data.link))
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  const unread = useMemo(() => state.items.filter((n) => !n.readAt).length, [state.items])
  useUnreadTitle(unread)

  const value = useMemo<NotificationFeed>(() => ({ status: state.status, items: state.items, unread, markRead, markAllRead }), [state.status, state.items, unread, markRead, markAllRead])
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>
}

/** Route element: everything below it shares one notification feed. */
export function NotificationsRoot() {
  return (
    <NotificationsProvider>
      <Outlet />
    </NotificationsProvider>
  )
}
