import { useInfiniteQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { formatInZone } from '@/features/reports/exports/format'
import { isDay } from '@/features/reports/days'
import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { strings } from '@/lib/strings'
import { useUsers } from '../queries'
import { downloadAuditCsv } from './exportAudit'
import { actionLabel, KNOWN_ACTIONS, PAGE_SIZE, summarise, TARGET_TYPES, targetLabel, type AuditEntry, type AuditFilters } from './model'
import { fetchAuditForExport, fetchAuditPage, type Cursor } from './queries'

const t = strings.audit

const today = (tz: string): string => {
  const k = dateKey(tz)
  return `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`
}
const daysAgo = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

function useFilters(tz: string) {
  const [params, setParams] = useSearchParams()
  const to = isDay(params.get('to')) ? (params.get('to') as string) : today(tz)
  const from = isDay(params.get('from')) ? (params.get('from') as string) : daysAgo(to, 6)
  const applied: AuditFilters = { from, to, actor: params.get('actor') ?? '', action: params.get('action') ?? '', target: params.get('target') ?? '' }
  const apply = (next: AuditFilters) =>
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '')), { replace: true })
  return { applied, apply }
}

function FilterBar({ applied, onApply, tz }: { applied: AuditFilters; onApply: (f: AuditFilters) => void; tz: string }) {
  const [draft, setDraft] = useState(applied)
  const [search, setSearch] = useState('')
  const users = useUsers('')
  const people = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users.data ?? []).filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || u.id === draft.actor).slice(0, 50)
  }, [users.data, search, draft.actor])
  const set = (patch: Partial<AuditFilters>) => setDraft((d) => ({ ...d, ...patch }))
  const invalid = draft.from > draft.to

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalid) onApply(draft)
      }}
      className="grid gap-3 rounded-xl border border-slate-200 bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={t.title}
    >
      <Input type="date" label={t.from} value={draft.from} max={today(tz)} onChange={(e) => set({ from: e.target.value })} />
      <Input type="date" label={t.to} value={draft.to} max={today(tz)} error={invalid ? t.to : undefined} onChange={(e) => set({ to: e.target.value })} />
      <Input type="search" label={t.actorPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select label={t.actor} value={draft.actor} onChange={(e) => set({ actor: e.target.value })}>
        <option value="">{t.anyActor}</option>
        {people.map((u) => (
          <option key={u.id} value={u.id}>{u.name} ({strings.roles[u.role]})</option>
        ))}
      </Select>
      <Select label={t.action} value={draft.action} onChange={(e) => set({ action: e.target.value })}>
        <option value="">{t.anyAction}</option>
        {KNOWN_ACTIONS.map((a) => (
          <option key={a} value={a}>{actionLabel(a)}</option>
        ))}
      </Select>
      <Select label={t.targetType} value={draft.target} onChange={(e) => set({ target: e.target.value })}>
        <option value="">{t.anyTarget}</option>
        {TARGET_TYPES.map((x) => (
          <option key={x} value={x}>{targetLabel(x)}</option>
        ))}
      </Select>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={invalid}>{t.apply}</Button>
        <Button
          variant="ghost"
          onClick={() => {
            const cleared: AuditFilters = { from: daysAgo(today(tz), 6), to: today(tz), actor: '', action: '', target: '' }
            setDraft(cleared)
            setSearch('')
            onApply(cleared)
          }}
        >
          {t.clear}
        </Button>
      </div>
    </form>
  )
}

function Detail({ entry, tz, actor, onClose }: { entry: AuditEntry; tz: string; actor: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={t.detailTitle} variant="drawer">
      <dl className="space-y-3 text-sm">
        <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.time}</dt><dd>{formatInZone(entry.createdAt, tz)}</dd></div>
        <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.actor}</dt><dd>{actor} ({entry.actorRole})</dd></div>
        <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.action}</dt><dd>{actionLabel(entry.action)} <code className="text-xs text-slate-600">{entry.action}</code></dd></div>
        <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.target}</dt><dd>{targetLabel(entry.targetType)}: <code className="break-all text-xs">{entry.targetId}</code></dd></div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.meta}</dt>
          <dd>
            {Object.keys(entry.meta).length === 0 ? (
              <span className="text-slate-600">{t.noMeta}</span>
            ) : (
              <pre data-testid="audit-meta" className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(entry.meta, null, 2)}</pre>
            )}
          </dd>
        </div>
      </dl>
    </Modal>
  )
}

/** `/admin/audit`: newest first, 25 per page, filters, a detail drawer and a CSV export of the current view. */
export default function AuditPage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const tz = tenant.data?.timezone ?? DEFAULT_TIMEZONE
  const { applied, apply } = useFilters(tz)
  const users = useUsers('')
  const [pageIndex, setPageIndex] = useState(0)
  const [open, setOpen] = useState<AuditEntry | null>(null)
  const [exporting, setExporting] = useState(false)

  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.name])), [users.data])
  const actorName = (uid: string): string => (uid === 'system' ? t.system : (names.get(uid) ?? t.unknownUser))
  // The platform super admin is not a user of this tenant: the entry carries the display name.
  const actorLabel = (e: AuditEntry): string => (e.actorRole === 'superadmin' ? (e.actorName ?? t.superAdmin) : actorName(e.actorUid))

  const key = ['audit', claims.tenantId, tz, applied] as const
  const pages = useInfiniteQuery({
    queryKey: key,
    enabled: !tenant.isPending,
    staleTime: 0,
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) => fetchAuditPage(claims.tenantId, applied, tz, pageParam, PAGE_SIZE),
    getNextPageParam: (last) => (last.more ? last.cursor : undefined),
  })

  // A new filter set starts at page 1 (the query key changes, so the cached pages are a different list).
  const [shownKey, setShownKey] = useState(JSON.stringify(applied))
  if (shownKey !== JSON.stringify(applied)) {
    setShownKey(JSON.stringify(applied))
    setPageIndex(0)
  }

  const loaded = pages.data?.pages ?? []
  const page = loaded[pageIndex]
  const hasNewer = pageIndex > 0
  const hasOlder = pageIndex < loaded.length - 1 || pages.hasNextPage

  const older = async () => {
    if (pageIndex < loaded.length - 1) setPageIndex(pageIndex + 1)
    else if (pages.hasNextPage) {
      await pages.fetchNextPage()
      setPageIndex(pageIndex + 1)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { entries, capped } = await fetchAuditForExport(claims.tenantId, applied, tz)
      const supers = new Map(entries.filter((e) => e.actorRole === 'superadmin').map((e) => [e.actorUid, e.actorName ?? t.superAdmin]))
      downloadAuditCsv(entries, applied, (uid) => supers.get(uid) ?? actorName(uid), tz)
      toast.success(capped ? `${t.exported(entries.length)} ${t.exportNote}` : t.exported(entries.length))
    } catch {
      toast.error(strings.common.somethingWrong)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-slate-600">{t.intro}</p>
        </div>
        <div className="text-right">
          <Button variant="secondary" loading={exporting} icon={<Download aria-hidden className="size-4" />} onClick={() => void exportCsv()}>
            {exporting ? t.exporting : t.exportCsv}
          </Button>
          <p className="pt-1 text-xs text-slate-600">{t.exportNote}</p>
        </div>
      </header>

      <FilterBar key={JSON.stringify(applied)} applied={applied} onApply={apply} tz={tz} />

      {pages.isPending ? (
        <div role="status" className="grid place-items-center py-16"><Spinner /></div>
      ) : pages.isError ? (
        <ErrorState message={t.loadFailed} error={pages.error} onRetry={() => void pages.refetch()} />
      ) : !page || page.entries.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-surface px-4 py-10 text-center text-sm text-slate-600">{t.empty}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t.title}</caption>
              <thead className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">{t.time}</th>
                  <th scope="col" className="px-4 py-3">{t.actor}</th>
                  <th scope="col" className="px-4 py-3">{t.action}</th>
                  <th scope="col" className="px-4 py-3">{t.target}</th>
                  <th scope="col" className="px-4 py-3">{t.summary}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{t.detailTitle}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{formatInZone(e.createdAt, tz)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{actorLabel(e)}</span>
                      <span className="block text-xs text-slate-600">{e.actorRole === 'superadmin' ? t.superAdminRole : (strings.roles[e.actorRole as keyof typeof strings.roles] ?? e.actorRole)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{actionLabel(e.action)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {targetLabel(e.targetType)}
                      {e.targetType === 'pass' ? (
                        <Link to={`/admin/passes?pass=${encodeURIComponent(e.targetId)}`} className="block max-w-40 truncate text-xs text-ink underline">{e.targetId}</Link>
                      ) : (
                        <span className="block max-w-40 truncate text-xs text-slate-600">{e.targetId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{summarise(e)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(e)} aria-label={`${t.detailTitle}: ${actionLabel(e.action)}`}>
                        {t.meta}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label={t.title} className="flex items-center justify-between">
            <Button variant="secondary" disabled={!hasNewer} onClick={() => setPageIndex(pageIndex - 1)}>{t.newerPage}</Button>
            <span aria-live="polite" className="text-sm text-slate-600">{t.page(pageIndex + 1)}</span>
            <Button variant="secondary" disabled={!hasOlder} loading={pages.isFetchingNextPage} onClick={() => void older()}>{t.olderPage}</Button>
          </nav>
        </>
      )}

      {open && <Detail entry={open} tz={tz} actor={actorLabel(open)} onClose={() => setOpen(null)} />}
    </div>
  )
}
