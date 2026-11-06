import { useInfiniteQuery } from '@tanstack/react-query'
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, where, writeBatch, type QueryDocumentSnapshot } from 'firebase/firestore'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import { useSession } from '@/features/auth/useAuth'
import { db } from '@/lib/firebase'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { useNotificationFeed } from './feedContext'
import { NotificationItem } from './NotificationItem'
import { safeLink, toNotification, type AppNotification } from './types'

const t = strings.notifications
export const PAGE_SIZE = 25

interface Page {
  items: AppNotification[]
  cursor: QueryDocumentSnapshot | null
  more: boolean
}

/** `/notifications` for every role: all notifications, 25 per page, newest first, cursor pagination. */
export default function NotificationsPage() {
  const { uid, claims } = useSession()
  const navigate = useNavigate()
  const { markAllRead, unread } = useNotificationFeed()
  // Items opened on this page, so the dot clears at once (the bell's live listener follows).
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())

  const pages = useInfiniteQuery({
    queryKey: ['notificationsPage', claims.tenantId, uid],
    staleTime: 0,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: async ({ pageParam }): Promise<Page> => {
      const snap = await getDocs(
        query(
          collection(db, 'notifications'),
          where('tenantId', '==', claims.tenantId),
          where('recipientUid', '==', uid),
          orderBy('createdAt', 'desc'),
          ...(pageParam ? [startAfter(pageParam)] : []),
          limit(PAGE_SIZE),
        ),
      )
      return { items: snap.docs.map((d) => toNotification(d.id, d.data())), cursor: snap.docs.at(-1) ?? null, more: snap.docs.length === PAGE_SIZE }
    },
    getNextPageParam: (last) => (last.more ? last.cursor : undefined),
  })

  const items = (pages.data?.pages.flatMap((p) => p.items) ?? []).map((n) => (opened.has(n.id) && !n.readAt ? { ...n, readAt: new Date() } : n))

  const open = (n: AppNotification) => {
    if (!n.readAt) {
      setOpened((prev) => new Set(prev).add(n.id))
      const batch = writeBatch(db)
      batch.update(doc(db, 'notifications', n.id), { readAt: serverTimestamp() })
      void batch.commit().catch(() => toast.error(t.markFailed))
    }
    void navigate(safeLink(n.link))
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link to={ROLE_HOME[claims.role]} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex items-center justify-between gap-3 pb-3 pt-1">
        <h1 className="text-xl font-semibold tracking-tight">{t.pageTitle}</h1>
        <Button
          variant="secondary"
          size="sm"
          disabled={unread === 0}
          onClick={() => void markAllRead().then(() => pages.refetch()).catch(() => toast.error(t.markFailed))}
        >
          {t.markAllRead}
        </Button>
      </div>

      {pages.isPending ? (
        <div role="status" className="grid place-items-center py-16"><Spinner /></div>
      ) : pages.isError ? (
        <ErrorState message={t.loadFailed} error={pages.error} onRetry={() => void pages.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-surface px-4 py-10 text-center text-sm text-slate-600">{t.empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface">
            {items.map((n) => (
              <NotificationItem key={n.id} item={n} onOpen={open} />
            ))}
          </ul>
          <div className="flex justify-center py-4">
            {pages.hasNextPage ? (
              <Button variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                {t.loadMore}
              </Button>
            ) : (
              <p className="text-sm text-slate-600">{t.noMore}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
