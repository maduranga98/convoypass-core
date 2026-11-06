import { NotificationsRoot } from '@/features/notifications/NotificationsProvider'

/** Under the auth guard: the live notification feed. */
export function AuthedShell() {
  return <NotificationsRoot />
}
