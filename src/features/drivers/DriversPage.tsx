import { Eye, KeyRound, LockKeyholeOpen, Pause, Pencil, Play, Plus, Users } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EligibilityBadge } from '@/components/ui/EligibilityBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { updateUser } from '@/lib/api'
import { formatPhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { ELIGIBILITY_STATUSES } from '@/lib/expiry'
import { strings } from '@/lib/strings'
import { eligibilityOf } from '@/features/shared/documents'
import { ReissuePinDialog, type ReissueTarget } from '@/features/admin/ReissuePinDialog'
import { useShowPin } from '@/features/admin/ShowPinDialog'
import { LastSignIn } from '@/features/admin/LastSignIn'
import { useBlocked } from '@/features/penalties/feed'
import { BlockedBadge } from '@/features/penalties/PenaltyBadges'
import { useSession } from '@/features/auth/useAuth'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ListToolbar } from '@/features/shared/ListToolbar'
import { CapNotice, ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList, useDriverAccounts, useDrivers, useVehicles } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Driver, Vehicle, WithId } from '@/types'
import { DriverAvatar } from './DriverAvatar'
import { DriverDrawer } from './DriverDrawer'
import { DriverFormModal } from './DriverForm'

const t = strings.drivers

export default function DriversPage({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient()
  const { uid } = useSession()
  const { isAdmin } = useScope(scope)
  const drivers = useDrivers(scope)
  const vehicles = useVehicles(scope)
  const contractors = useContractorList(scope)
  const accounts = useDriverAccounts(scope)
  const blocked = useBlocked(scope)

  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [eligibility, setEligibility] = useState('')
  const [contractorId, setContractorId] = useState(isAdmin ? (params.get('contractor') ?? '') : '')
  const [formFor, setFormFor] = useState<WithId<Driver> | 'new' | null>(params.get('new') ? 'new' : null)
  const [reissuing, setReissuing] = useState<ReissueTarget | null>(null)
  const [showPin, showPinModal] = useShowPin()
  const [toggling, setToggling] = useState<WithId<Driver> | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => drivers.data?.items ?? [], [drivers.data])
  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])

  // Assignments live on the vehicle (`assignedDriverIds`); the driver's chips are derived from them.
  const vehiclesByDriver = useMemo(() => {
    const map = new Map<string, WithId<Vehicle>[]>()
    for (const v of vehicles.data?.items ?? []) {
      for (const id of v.assignedDriverIds) map.set(id, [...(map.get(id) ?? []), v])
    }
    return map
  }, [vehicles.data])

  const filtered = useMemo(
    () =>
      items.filter(
        (d) =>
          (!status || d.status === status) &&
          (!eligibility || eligibilityOf(d) === eligibility) &&
          (!contractorId || d.contractorId === contractorId) &&
          matchesSearch(
            [d.name, d.phone, formatPhone(d.phone), d.licenseNo ?? '', ...(vehiclesByDriver.get(d.id) ?? []).map((v) => `${v.plateNo} ${v.plateKey}`)].join(' '),
            search,
          ),
      ),
    [items, status, eligibility, contractorId, search, vehiclesByDriver],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)
  const closeForm = () => {
    setFormFor(null)
    if (params.has('new')) setParams({}, { replace: true })
  }
  const clear = () => {
    setSearch('')
    setStatus('')
    setEligibility('')
    setContractorId('')
  }

  const toggleStatus = async () => {
    if (!toggling) return
    const disabling = toggling.status === 'active'
    setBusy(true)
    try {
      await updateUser({ uid: toggling.id, status: disabling ? 'disabled' : 'active' })
      await queryClient.invalidateQueries({ queryKey: ['drivers'] })
      toast.success(disabling ? t.disabled : t.enabled)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
      setToggling(null)
    }
  }

  const columns: Column<WithId<Driver>>[] = [
    {
      key: 'driver',
      header: t.columns.driver,
      primary: true,
      cell: (d) => (
        <span className="flex items-center gap-3">
          <DriverAvatar driver={d} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{d.name}</span>
            {isAdmin && <span className="block truncate text-xs text-slate-500">{contractorNames.get(d.contractorId) ?? strings.common.none}</span>}
          </span>
        </span>
      ),
    },
    { key: 'phone', header: t.columns.phone, cell: (d) => <span className="font-mono text-sm">{d.phone ? formatPhone(d.phone) : strings.common.none}</span> },
    {
      key: 'vehicles',
      header: t.columns.vehicles,
      cell: (d) => {
        const list = vehiclesByDriver.get(d.id) ?? []
        return list.length === 0 ? (
          <span className="text-slate-600">{t.noVehicles}</span>
        ) : (
          <ul className="flex flex-wrap justify-end gap-1 md:justify-start">
            {list.map((v) => (
              <li key={v.id}>
                <Badge tone={v.status === 'active' ? 'accent' : 'neutral'}>{v.plateNo}</Badge>
              </li>
            ))}
          </ul>
        )
      },
    },
    {
      key: 'documents',
      header: t.columns.documents,
      cell: (d) => (
        <span className="flex flex-col items-end gap-0.5 md:items-start">
          {/* A penalty overrides the document status: blocked is shown first, the licence status stays visible. */}
          {blocked.drivers.has(d.id) && <BlockedBadge />}
          <EligibilityBadge status={d.eligibilityStatus} />
          {d.licenseExpiry && <span className="font-mono text-xs text-slate-500">{d.licenseExpiry}</span>}
        </span>
      ),
    },
    {
      key: 'lastSignIn',
      header: t.columns.lastSignIn,
      cell: (d) => {
        const account = accounts.data?.get(d.id)
        return account ? <LastSignIn user={account} /> : strings.common.none
      },
    },
    { key: 'status', header: t.columns.status, cell: (d) => <StatusBadge status={d.status} /> },
  ]

  const actions = (d: WithId<Driver>) => {
    const disabling = d.status === 'active'
    const label = disabling ? t.disable : t.enable
    return (
      <div className="inline-flex gap-1">
        <Button variant="ghost" size="icon" title={t.details} aria-label={`${t.details}: ${d.name}`} onClick={() => setDetailId(d.id)}>
          <Eye aria-hidden className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title={strings.common.edit} aria-label={`${strings.common.edit}: ${d.name}`} onClick={() => setFormFor(d)}>
          <Pencil aria-hidden className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={strings.reissue.show}
          aria-label={`${strings.reissue.show}: ${d.name}`}
          onClick={() => void showPin({ id: d.id, name: d.name, role: 'driver', company: contractorNames.get(d.contractorId) ?? '' })}
        >
          <LockKeyholeOpen aria-hidden className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={strings.reissue.action}
          aria-label={`${strings.reissue.action}: ${d.name}`}
          onClick={() => setReissuing({ id: d.id, name: d.name, role: 'driver', company: contractorNames.get(d.contractorId) ?? '' })}
        >
          <KeyRound aria-hidden className="size-4" />
        </Button>
        {d.id !== uid && (
          <Button variant="ghost" size="icon" title={label} aria-label={`${label}: ${d.name}`} onClick={() => setToggling(d)}>
            {disabling ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          </Button>
        )}
      </div>
    )
  }

  const loading = drivers.isPending || vehicles.isPending || contractors.isPending
  const failed = drivers.isError || vehicles.isError || contractors.isError

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormFor('new')}>
          {t.add}
        </Button>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : failed ? (
        <ErrorState error={drivers.error ?? vehicles.error ?? contractors.error} onRetry={() => void Promise.all([drivers.refetch(), vehicles.refetch(), contractors.refetch()])} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Users aria-hidden />} title={t.emptyTitle} body={t.emptyBody} action={<Button onClick={() => setFormFor('new')}>{t.add}</Button>} />
      ) : (
        <>
          <CapNotice show={drivers.data?.capped === true} />
          <ListToolbar
            search={search}
            onSearch={setSearch}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.searchPlaceholder}
            status={status}
            onStatus={setStatus}
            statusOptions={[
              { value: 'active', label: strings.status.active },
              { value: 'disabled', label: strings.status.disabled },
            ]}
            {...(isAdmin
              ? { contractors: (contractors.data ?? []).map((c) => ({ id: c.id, name: c.name })), contractorId, onContractor: setContractorId }
              : {})}
            filters={
              <FilterSelect label={strings.eligibility.label} value={eligibility} onChange={(e) => setEligibility(e.target.value)}>
                <option value="">{strings.eligibility.all}</option>
                {ELIGIBILITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {strings.eligibility[s]}
                  </option>
                ))}
              </FilterSelect>
            }
            end={strings.list.count(filtered.length, items.length)}
          />
          {filtered.length === 0 ? (
            <EmptyState title={strings.list.noMatchTitle} body={strings.list.noMatchBody} action={<ClearFilters onClick={clear} />} />
          ) : (
            <>
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(d) => d.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}

      <DriverDrawer scope={scope} driver={items.find((d) => d.id === detailId) ?? null} contractorName={contractorNames.get(items.find((d) => d.id === detailId)?.contractorId ?? '')} onClose={() => setDetailId(null)} />
      <DriverFormModal scope={scope} target={formFor} onClose={closeForm} />
      <ReissuePinDialog target={reissuing} onClose={() => setReissuing(null)} />
      {showPinModal}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === 'active' ? t.disableTitle : t.enableTitle}
        body={toggling ? (toggling.status === 'active' ? t.disableBody(toggling.name) : t.enableBody(toggling.name)) : ''}
        confirmLabel={toggling?.status === 'active' ? t.disable : t.enable}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setToggling(null)}
      />
    </div>
  )
}
