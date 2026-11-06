import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { relativeTime } from './relativeTime'
import type { AppNotification } from './types'

interface Props {
  item: AppNotification
  onOpen: (item: AppNotification) => void
  now?: Date
}

/** One row: unread dot, title, body, relative time. The whole row is the button (44 px+ target). */
export function NotificationItem({ item, onOpen, now }: Props) {
  const unread = item.readAt === null
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span
          aria-hidden
          className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', unread ? 'bg-warning' : 'bg-transparent ring-1 ring-slate-300')}
        />
        <span className="min-w-0 flex-1">
          {unread && <span className="sr-only">{strings.notifications.unread}: </span>}
          <span className={cn('block text-sm text-ink', unread ? 'font-semibold' : 'font-medium')}>{item.title}</span>
          <span className="block text-sm text-slate-700">{item.body}</span>
          <time dateTime={item.createdAt.toISOString()} className="block pt-0.5 text-xs text-slate-600">
            {relativeTime(item.createdAt, now, strings.notifications.justNow)}
          </time>
        </span>
      </button>
    </li>
  )
}
