import { Bell as BellIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useNotificationFeed } from './feedContext'
import { NotificationItem } from './NotificationItem'
import { safeLink, type AppNotification } from './types'

const t = strings.notifications

interface Props {
  /** Which edge of the button the panel lines up with on wide screens. Narrow screens use the full width. */
  align?: 'left' | 'right'
  /** `dark` sits on a brand red bar (supervisor layout). */
  tone?: 'light' | 'dark'
  className?: string
}

/** Header bell with an unread badge (live) and a panel of the latest items. */
export function Bell({ align = 'right', tone = 'light', className }: Props) {
  const { items, unread, status, markRead, markAllRead } = useNotificationFeed()
  const navigate = useNavigate()
  const location = useLocation()
  // Open for one page only: navigating anywhere closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.pathname
  const path = location.pathname
  const toggle = () => setOpenOn((cur) => (cur === path ? null : path))
  const close = useCallback(() => setOpenOn(null), [])
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // Close on navigation, outside click and Escape (focus goes back to the bell).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const openItem = (item: AppNotification) => {
    close()
    if (!item.readAt) void markRead(item.id).catch(() => toast.error(t.markFailed))
    void navigate(safeLink(item.link))
  }

  const shown = items.slice(0, 8)
  return (
    <div ref={root} className={cn('relative print:hidden', className)}>
      <button
        ref={button}
        type="button"
        aria-label={unread > 0 ? t.bellUnread(unread) : t.bell}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={cn(
          'relative inline-flex size-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2',
          tone === 'dark' ? 'text-on-solid hover:bg-brand-hover focus-visible:outline-on-solid' : 'text-slate-700 hover:bg-slate-100 focus-visible:outline-focus',
        )}
      >
        <BellIcon aria-hidden className="size-5" />
        {unread > 0 && (
          <span
            aria-hidden
            data-testid="bell-badge"
            className="absolute right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-danger-strong px-1 text-[11px] font-bold leading-5 text-on-solid"
          >
            {unread >= 50 ? '50+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={t.panelTitle}
          className={cn(
            'fixed inset-x-2 top-14 z-40 max-h-[80dvh] overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-lg',
            'sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-96',
            align === 'right' ? 'sm:right-0' : 'sm:left-0',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <h2 className="text-sm font-semibold">{t.panelTitle}</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={unread === 0}
              onClick={() => void markAllRead().catch(() => toast.error(t.markFailed))}
            >
              {t.markAllRead}
            </Button>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">
            {status === 'error' ? (
              <p role="alert" className="px-4 py-6 text-sm text-danger-ink">{t.loadFailed}</p>
            ) : status === 'loading' ? (
              <p role="status" className="px-4 py-6 text-sm text-slate-600">{strings.common.loading}</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-600">{t.empty}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((n) => (
                  <NotificationItem key={n.id} item={n} onOpen={openItem} />
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm">
            <Link to="/notifications" className="inline-flex min-h-11 items-center font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              {t.seeAll}
            </Link>
            <Link to="/settings" className="inline-flex min-h-11 items-center text-slate-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              {t.settings}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
