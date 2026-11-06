import { GraduationCap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { CapNotice, ShowMore } from '@/features/shared/ListStates'
import { useContractorList, useDrivers } from '@/features/shared/queries'
import { QualificationBadge } from './QualificationBadge'
import { RecordQualificationDialog, type RecordTarget } from './RecordQualificationDialog'
import { cellsOf, problemCount, useRequirementContext } from './model'

const t = strings.qualifications

/**
 * Admin and Officer: every active driver against every required qualification. "Record" saves the completion date
 * (valid one year); a missing or expired one keeps the driver out of the monthly pass list and the gate. The
 * tenant-wide driver list is the one the rules give both roles.
 */
export default function QualificationsPage() {
  const ctx = useRequirementContext()
  const drivers = useDrivers('admin')
  const contractors = useContractorList('admin')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<RecordTarget | null>(null)

  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const rows = useMemo(
    () =>
      (drivers.data?.items ?? [])
        .filter((d) => d.status === 'active' && matchesSearch(`${d.name} ${contractorNames.get(d.contractorId) ?? ''}`, search))
        .map((d) => ({ driver: d, cells: cellsOf(ctx.types, d.qualifications, ctx.today, ctx.warningDays) }))
        // Drivers who still need something first.
        .sort((a, b) => problemCount(b.cells) - problemCount(a.cells) || a.driver.name.localeCompare(b.driver.name)),
    [drivers.data, contractorNames, search, ctx.types, ctx.today, ctx.warningDays],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(rows)

  const loading = drivers.isPending || contractors.isPending || ctx.isPending
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : drivers.isError || contractors.isError ? (
        <ErrorState error={drivers.error ?? contractors.error} onRetry={() => void Promise.all([drivers.refetch(), contractors.refetch()])} />
      ) : (drivers.data?.items ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <>
          {ctx.types.length === 0 && <NotificationBanner tone="info">{t.noTypes}</NotificationBanner>}
          <CapNotice show={drivers.data?.capped === true} />
          <Input label={t.searchLabel} type="search" value={search} placeholder={t.searchPlaceholder} onChange={(e) => setSearch(e.target.value)} />
          <ul className="space-y-3">
            {visible.map(({ driver, cells }) => {
              const problems = problemCount(cells)
              return (
                <li key={driver.id} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{driver.name}</p>
                      <p className="truncate text-xs text-slate-500">{contractorNames.get(driver.contractorId) ?? strings.common.none}</p>
                    </div>
                    <p className="text-sm text-slate-600">{problems === 0 ? t.ready : t.notReady(problems)}</p>
                  </div>
                  {cells.length > 0 && (
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {cells.map((c) => (
                        <li key={c.type.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                          <div className="min-w-0 space-y-1">
                            <p className="truncate text-sm font-medium">{c.type.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <QualificationBadge state={c.state} />
                              {c.expiresOn && <span className="font-mono text-xs text-slate-500">{t.until(c.expiresOn)}</span>}
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`${c.state === 'missing' ? t.record : t.renew}: ${c.type.name}, ${driver.name}`}
                            onClick={() => setTarget({ driverId: driver.id, driverName: driver.name, typeId: c.type.id, typeName: c.type.name })}
                          >
                            {c.state === 'missing' ? t.record : t.renew}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
        </>
      )}
      <RecordQualificationDialog target={target} today={ctx.today} onClose={() => setTarget(null)} />
    </div>
  )
}
