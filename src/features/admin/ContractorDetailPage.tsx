import { format } from 'date-fns'
import { ArrowLeft, Pause, Pencil, Play } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import { DriverAvatar } from '@/features/drivers/DriverAvatar'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { useUsers } from './queries'
import { ContractorFormModal } from './ContractorForm'
import { ContractorStatusDialog } from './ContractorStatusDialog'

const t = strings.admin.contractors
const PREVIEW = 8

function Section({ title, to, count, children }: { title: string; to?: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-slate-600">{count}</span>
        </h2>
        {to && count > PREVIEW && (
          <Link to={to} className="rounded text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t.viewAll}
          </Link>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-surface">{children}</div>
    </section>
  )
}

export default function ContractorDetailPage() {
  const { contractorId = '' } = useParams()
  const contractors = useContractorList('admin')
  const vehicles = useVehicles('admin')
  const drivers = useDrivers('admin')
  const supervisors = useUsers('supervisor')
  const [editing, setEditing] = useState(false)
  const [toggling, setToggling] = useState(false)

  const contractor = contractors.data?.find((c) => c.id === contractorId) ?? null
  const myVehicles = useMemo(() => (vehicles.data?.items ?? []).filter((v) => v.contractorId === contractorId), [vehicles.data, contractorId])
  const myDrivers = useMemo(() => (drivers.data?.items ?? []).filter((d) => d.contractorId === contractorId), [drivers.data, contractorId])
  const mySupervisors = useMemo(() => (supervisors.data ?? []).filter((u) => u.contractorId === contractorId), [supervisors.data, contractorId])

  const back = (
    <Link to="/admin/contractors" className="inline-flex items-center gap-1.5 rounded text-sm text-slate-500 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <ArrowLeft aria-hidden className="size-4" />
      {t.back}
    </Link>
  )

  if (contractors.isPending) {
    return (
      <div className="space-y-5">
        {back}
        <ListSkeleton rows={3} />
      </div>
    )
  }
  if (contractors.isError) {
    return (
      <div className="space-y-5">
        {back}
        <ErrorState error={contractors.error} onRetry={() => void contractors.refetch()} />
      </div>
    )
  }
  if (!contractor) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState title={t.notFound} />
      </div>
    )
  }

  const suspended = contractor.status === 'suspended'
  const rows: [string, ReactNode][] = [
    [t.contactName, contractor.contactName || strings.common.none],
    [t.phone, contractor.phone || strings.common.none],
    [t.address, contractor.address || strings.common.none],
    [t.notes, contractor.notes ? <span className="whitespace-pre-line">{contractor.notes}</span> : strings.common.none],
    [t.columns.vehicles, myVehicles.length],
    [t.columns.drivers, myDrivers.length],
    ...(contractor.createdAt ? ([[t.createdOn, format(contractor.createdAt.toDate(), 'd MMM yyyy')]] as [string, ReactNode][]) : []),
  ]

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{contractor.name}</h1>
          <StatusBadge status={contractor.status} />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Pencil aria-hidden className="size-4" />} onClick={() => setEditing(true)}>
            {strings.common.edit}
          </Button>
          <Button
            variant={suspended ? 'secondary' : 'danger'}
            icon={suspended ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
            onClick={() => setToggling(true)}
          >
            {suspended ? t.activate : t.suspend}
          </Button>
        </div>
      </div>

      <section aria-label={t.summary}>
        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-surface text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 px-4 py-3">
              <dt className="shrink-0 text-slate-500">{label}</dt>
              <dd className="min-w-0 text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section title={t.supervisors} count={mySupervisors.length}>
        {supervisors.isPending ? (
          <p className="px-4 py-4 text-sm text-slate-500">{strings.common.loading}</p>
        ) : supervisors.isError ? (
          <ErrorState error={supervisors.error} onRetry={() => void supervisors.refetch()} />
        ) : mySupervisors.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">{t.noSupervisors}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mySupervisors.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="block truncate text-xs text-slate-500">{u.email}</span>
                </span>
                <StatusBadge status={u.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={strings.vehicles.title} count={myVehicles.length} to={`/admin/vehicles?contractor=${contractor.id}`}>
        {vehicles.isPending ? (
          <p className="px-4 py-4 text-sm text-slate-500">{strings.common.loading}</p>
        ) : vehicles.isError ? (
          <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} />
        ) : myVehicles.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">{t.noVehicles}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myVehicles.slice(0, PREVIEW).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="font-mono font-semibold tracking-wide">{v.plateNo}</span>
                <span className="flex items-center gap-2">
                  <Badge>{v.type}</Badge>
                  <StatusBadge status={v.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={strings.drivers.title} count={myDrivers.length} to={`/admin/drivers?contractor=${contractor.id}`}>
        {drivers.isPending ? (
          <p className="px-4 py-4 text-sm text-slate-500">{strings.common.loading}</p>
        ) : drivers.isError ? (
          <ErrorState error={drivers.error} onRetry={() => void drivers.refetch()} />
        ) : myDrivers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">{t.noDrivers}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myDrivers.slice(0, PREVIEW).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <DriverAvatar driver={d} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block font-mono text-xs text-slate-500">{formatPhone(d.phone)}</span>
                  </span>
                </span>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ContractorFormModal target={editing ? contractor : null} onClose={() => setEditing(false)} />
      <ContractorStatusDialog contractor={toggling ? contractor : null} onClose={() => setToggling(false)} />
    </div>
  )
}
