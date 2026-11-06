import { createContext, useContext } from 'react'
import type { AppNotification } from './types'

export interface NotificationFeed {
  status: 'loading' | 'ready' | 'error'
  /** Newest first, at most the last 50. */
  items: AppNotification[]
  /** Unread among `items`. */
  unread: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

export const FeedContext = createContext<NotificationFeed | null>(null)

export function useNotificationFeed(): NotificationFeed {
  const ctx = useContext(FeedContext)
  if (!ctx) throw new Error('useNotificationFeed must be used within <NotificationsProvider>')
  return ctx
}

export const FEED_LIMIT = 50
