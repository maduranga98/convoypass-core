import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, UserRoundPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { SearchField } from '@/components/ui/SearchField'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useBlocked } from '@/features/penalties/feed'
import { usePassQueue } from '@/features/passes/usePassQueue'
import { useToday } from '@/features/passes/useToday'
import { useDrivers, useVehicles } from '@/features/shared/queries'
import { assignableDrivers } from '@/features/vehicles/assignable'
import { DriverPicker } from '@/features/vehicles/DriverPicker'
import { useDriverAssignments } from '@/features/vehicles/useDriverAssignments'
import { setVehicleDrivers } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { plateSearchKey as plainKey } from '@/lib/plate'
import { strings } from '@/lib/strings'
import type { Vehicle, WithId } from '@/types'
import { attentionReasons } from './assignDrivers'

const t = strings.supervisor.assign

/**
 * The supervisor's own screen for putting drivers on vehicles: vehicles that lost their driver or whose pass was rejected
 * today come first. Saves through `setVehicleDrivers` (the server also refuses a driver who is on another vehicle).
 */
export default function AssignDriversPage() {
  const queryClient = useQueryClient()
  const vehicles = useVehicles('supervisor')
  const drivers = useDrivers('supervisor')
  const blocked = useBlocked('supervisor')
  const today = useToday()
  const rejected = usePassQueue({ scope: 'supervisor', status: 'rejected', ...(today ? { dateKey: today } : {}), enabled: today !== null })
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<WithId<Vehicle> | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const takenBy = useDriverAssignments('supervisor', target?.id)

  const allDrivers = useMemo(() => drivers.data?.items ?? [], [drivers.data])
  const byId = useMemo(() => new Map(allDrivers.map((d) => [d.id, d])), [allDrivers])
  const rejectedIds = useMemo(() => new Set(rejected.items.map((p) => p.vehicleId)), [rejected.items])
  const blockedDrivers = useMemo(() => new Set(blocked.drivers.keys()), [blocked.drivers])

  const rows = useMemo(() => {
    const needle = plainKey(q)
    return (vehicles.data?.items ?? [])
      .map((v) => ({ v, reasons: attentionReasons(v, byId, rejectedIds) }))
      .filter(({ v }) => !needle || plainKey(v.plateNo).includes(needle) || v.assignedDriverIds.some((id) => plainKey(byId.get(id)?.name ?? '').includes(needle)))
      .sort((a, b) => b.reasons.length - a.reasons.length || a.v.plateKey.localeCompare(b.v.plateKey))
  }, [vehicles.data, byId, rejectedIds, q])
  const attention = rows.filter((r) => r.reasons.length > 0).length

  const open = (v: WithId<Vehicle>) => {
    const active = new Set(assignableDrivers(allDrivers, v.contractorId).map((d) => d.id))
    setPicked(v.assignedDriverIds.filter((id) => active.has(id)))
    setTarget(v)
  }

  const save = async () => {
    if (!target) return
    setSaving(true)
    try {
      await setVehicleDrivers({ vehicleId: target.id, driverIds: picked })
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success(t.saved)
      setTarget(null)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const loading = vehicles.isPending || drivers.isPending
  const failed = vehicles.isError || drivers.isError

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
        <p className="text-sm text-slate-600">{t.intro}</p>
      </header>

      <SearchField label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />

      {failed ? (
        <ErrorState message={t.loadFailed} error={vehicles.error ?? drivers.error} onRetry={() => { void vehicles.refetch(); void drivers.refetch() }} />
      ) : loading ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={strings.vehicles.emptyTitle} />
        </div>
      ) : (
        <>
          {attention === 0 && !q && <NotificationBanner tone="success">{t.allGood}</NotificationBanner>}
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            {rows.map(({ v, reasons }) => {
              const names = v.assignedDriverIds.map((id) => ({ id, d: byId.get(id) }))
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold tracking-tight">{v.plateNo}</span>
                      {v.status !== 'active' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{t.suspended}</span>}
                      {reasons.map((r) => (
                        <span key={r} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">
                          <AlertTriangle aria-hidden className="size-3.5" />
                          {r === 'no-driver' ? t.reasonNoDriver : t.reasonRejected}
                        </span>
                      ))}
                    </p>
                    <p className="truncate text-sm text-slate-600">
                      {names.length === 0
                        ? t.noDriver
                        : names.map(({ d, id }) => (d ? (d.status === 'active' ? d.name : t.inactiveDriver(d.name)) : id)).join(', ')}
                    </p>
                  </div>
                  {v.status === 'active' && (
                    <Button variant="secondary" size="sm" onClick={() => open(v)}>
                      <UserRoundPlus aria-hidden className="size-4" />
                      {names.length === 0 ? t.assign : t.change}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Modal
        open={target !== null}
        onClose={() => (saving ? undefined : setTarget(null))}
        title={target ? t.sheetTitle(target.plateNo) : ''}
        variant="sheet"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={saving}>{strings.common.cancel}</Button>
            <Button onClick={() => void save()} loading={saving}>{t.save}</Button>
          </div>
        }
      >
        {target && <DriverPicker drivers={allDrivers} contractorId={target.contractorId} value={picked} onChange={setPicked} disabled={saving} blockedIds={blockedDrivers} takenBy={takenBy} />}
      </Modal>
    </div>
  )
}
