import { useQueryClient } from '@tanstack/react-query'
import { Pause, Pencil, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EligibilityBadge } from '@/components/ui/EligibilityBadge'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useSession } from '@/features/auth/useAuth'
import { setVehicleDrivers, setVehicleStatus } from '@/lib/api'
import { can } from '@/lib/permissions'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { GatePassSection } from '@/features/gatePasses/GatePassSection'
import { PreTripBadge } from './PreTripBadge'
import { usePreTripToday } from './usePreTripToday'
import { ClearanceBadge } from '@/features/inspections/ClearanceBadge'
import { InspectionHistory } from '@/features/inspections/InspectionHistory'
import { clearanceOfVehicle } from '@/features/inspections/model'
import { useBlocked } from '@/features/penalties/feed'
import { BlockedBadge } from '@/features/penalties/PenaltyBadges'
import { PenaltyHistory } from '@/features/penalties/PenaltyHistory'
import { VisitHistory } from '@/features/visits/VisitHistory'
import { ExpiryRow } from '@/features/shared/ExpiryRow'
import { VehicleQrPanel } from '@/features/qr/VehicleQrPanel'
import { useDrivers } from '@/features/shared/queries'
import type { Scope } from '@/features/shared/scope'
import type { Vehicle, WithId } from '@/types'
import { assignableDrivers } from './assignable'
import { DriverPicker } from './DriverPicker'
import { useDriverAssignments } from './useDriverAssignments'

const t = strings.vehicles.drawer

interface Props {
  scope: Scope
  vehicle: WithId<Vehicle> | null
  contractorName: string | undefined
  onClose: () => void
  onEdit: (v: WithId<Vehicle>) => void
}

/** Detail drawer: QR (preview, downloads, copy, print), assigned drivers (editable) and suspend / activate. */
export function VehicleDrawer({ scope, vehicle, contractorName, onClose, onEdit }: Props) {
  return (
    <Modal open={vehicle !== null} onClose={onClose} title={vehicle?.plateNo ?? ''} variant="drawer">
      {vehicle && <DrawerBody scope={scope} vehicle={vehicle} contractorName={contractorName} onEdit={onEdit} />}
    </Modal>
  )
}

function DrawerBody({ scope, vehicle, contractorName, onEdit }: Omit<Props, 'vehicle' | 'onClose'> & { vehicle: WithId<Vehicle> }) {
  const queryClient = useQueryClient()
  const drivers = useDrivers(scope)
  const blocked = useBlocked(scope)
  const preTrip = usePreTripToday(scope)
  const takenBy = useDriverAssignments(scope, vehicle.id)
  const blockedDrivers = useMemo(() => new Set(blocked.drivers.keys()), [blocked.drivers])
  const all = useMemo(() => drivers.data?.items ?? [], [drivers.data])
  const names = useMemo(() => new Map(all.map((d) => [d.id, d])), [all])
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toggling, setToggling] = useState(false)

  const { claims } = useSession()
  const canSetStatus = can(claims.role, 'vehicle.setStatus')
  const suspending = vehicle.status === 'active'
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vehicles'] })

  const startEditing = () => {
    const active = new Set(assignableDrivers(all, vehicle.contractorId).map((d) => d.id))
    setPicked(vehicle.assignedDriverIds.filter((id) => active.has(id)))
    setEditing(true)
  }

  const saveDrivers = async () => {
    setSaving(true)
    try {
      await setVehicleDrivers({ vehicleId: vehicle.id, driverIds: picked })
      await refresh()
      toast.success(t.driversSaved)
      setEditing(false)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async () => {
    setToggling(true)
    try {
      await setVehicleStatus({ vehicleId: vehicle.id, status: suspending ? 'suspended' : 'active' })
      await refresh()
      toast.success(suspending ? t.suspended : t.activated)
      setConfirming(false)
    } catch (e) {
      toast.error(apiErrorMessage(e))
      setConfirming(false)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={vehicle.status} />
        {blocked.vehicles.has(vehicle.id) && <BlockedBadge />}
        <Badge tone="accent">{vehicle.type}</Badge>
        {vehicle.makeModel && <span className="text-sm text-slate-600">{vehicle.makeModel}</span>}
        {contractorName && scope === 'admin' && <span className="text-sm text-slate-500">· {contractorName}</span>}
      </div>

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={t.documents}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.documents}</h3>
          <EligibilityBadge status={vehicle.eligibilityStatus} />
        </div>
        <dl className="space-y-1.5 text-sm">
          <ExpiryRow label={strings.eligibility.insurance} date={vehicle.insuranceExpiry} />
          <ExpiryRow label={strings.eligibility.registration} date={vehicle.registrationExpiry} />
          <ExpiryRow label={strings.eligibility.annualInspection} date={vehicle.annualInspectionExpiry} />
        </dl>
      </section>

      <section className="space-y-1 border-t border-slate-100 pt-5" aria-label={strings.vehicles.preTrip.label}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{strings.vehicles.preTrip.label}</h3>
          <PreTripBadge pass={preTrip.get(vehicle.id)} />
        </div>
        <p className="text-xs text-slate-600">{strings.vehicles.preTrip.hint}</p>
      </section>

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={strings.inspections.clearance.label}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{strings.inspections.clearance.label}</h3>
          <ClearanceBadge clearance={clearanceOfVehicle(vehicle)} />
        </div>
        {vehicle.clearance?.status === 'needs_reinspection' && vehicle.clearance.reason && (
          <p className="text-sm text-slate-700">{strings.inspections.reasonDetail[vehicle.clearance.reason]}</p>
        )}
      </section>

      <GatePassSection scope={scope} field="vehicleId" id={vehicle.id} overviewPath={scope === 'admin' ? '/admin/gate-passes' : undefined} />

      <VehicleQrPanel vehicle={vehicle} scope={scope} />

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={t.drivers}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.drivers}</h3>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={startEditing} disabled={drivers.isPending}>
              {t.editDrivers}
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <DriverPicker drivers={all} contractorId={vehicle.contractorId} value={picked} onChange={setPicked} disabled={saving} blockedIds={blockedDrivers} takenBy={takenBy} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                {strings.common.cancel}
              </Button>
              <Button size="sm" onClick={() => void saveDrivers()} loading={saving}>
                {t.saveDrivers}
              </Button>
            </div>
          </div>
        ) : vehicle.assignedDriverIds.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.vehicles.noDrivers}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {vehicle.assignedDriverIds.map((id) => {
              const d = names.get(id)
              return (
                <li key={id}>
                  <Badge tone={d?.status === 'disabled' ? 'neutral' : 'accent'}>{d?.name ?? strings.common.none}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <PenaltyHistory scope={scope} vehicleId={vehicle.id} />

      <InspectionHistory scope={scope} vehicleId={vehicle.id} />
      <VisitHistory scope={scope} field="vehicleId" id={vehicle.id} />

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-5 sm:flex-row">
        <Button variant="secondary" className="sm:flex-1" icon={<Pencil aria-hidden className="size-4" />} onClick={() => onEdit(vehicle)}>
          {strings.common.edit}
        </Button>
        {canSetStatus && (
          <Button
            variant={suspending ? 'danger' : 'secondary'}
            className="sm:flex-1"
            icon={suspending ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
            onClick={() => setConfirming(true)}
          >
            {suspending ? t.suspend : t.activate}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming && canSetStatus}
        title={suspending ? t.suspendTitle : t.activateTitle}
        body={suspending ? t.suspendBody(vehicle.plateNo) : t.activateBody(vehicle.plateNo)}
        confirmLabel={suspending ? strings.admin.contractors.suspend : strings.admin.contractors.activate}
        tone={suspending ? 'danger' : 'primary'}
        loading={toggling}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
