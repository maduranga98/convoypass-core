import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useDrivers, useVehicles } from '@/features/shared/queries'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { monthLabel } from './model'
import { useGatePassMutations } from './queries'

const t = strings.gatePasses.add

/**
 * Company Admin: issue a pass for one vehicle and driver in the middle of the month (a new vehicle, a new driver, a driver
 * swap). It uses the same callable as the month-end list, so the server re-checks the pairing (assigned, active, eligible
 * now) and issuing twice is harmless.
 */
export function AddPassAction({ month }: { month: string }) {
  const vehicles = useVehicles('admin')
  const drivers = useDrivers('admin')
  const { issue } = useGatePassMutations()
  const [open, setOpen] = useState(false)
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const driverNames = useMemo(() => new Map((drivers.data?.items ?? []).filter((d) => d.status === 'active').map((d) => [d.id, d.name])), [drivers.data])
  const options = useMemo(() => (vehicles.data?.items ?? []).filter((v) => v.status === 'active' && v.assignedDriverIds.some((id) => driverNames.has(id))), [vehicles.data, driverNames])
  const vehicle = options.find((v) => v.id === vehicleId)
  const assigned = vehicle ? vehicle.assignedDriverIds.filter((id) => driverNames.has(id)) : []

  const close = () => {
    setOpen(false)
    setVehicleId('')
    setDriverId('')
    setProblem(null)
  }

  const pickVehicle = (id: string) => {
    setVehicleId(id)
    setProblem(null)
    const only = options.find((v) => v.id === id)?.assignedDriverIds.filter((d) => driverNames.has(d)) ?? []
    setDriverId(only.length === 1 ? (only[0] ?? '') : '')
  }

  const submit = () => {
    if (!vehicleId || !driverId) return
    setProblem(null)
    issue.mutate(
      { month, pairs: [{ vehicleId, driverId }] },
      {
        onSuccess: (res) => {
          const r = res.results[0]
          if (r?.ok) {
            toast.success(r.existing ? t.already : t.issued)
            close()
            return
          }
          setProblem(r?.error !== undefined && Object.prototype.hasOwnProperty.call(strings.apiErrors, r.error) ? strings.apiErrors[r.error as keyof typeof strings.apiErrors] : strings.common.somethingWrong)
        },
        onError: (e) => setProblem(apiErrorMessage(e)),
      },
    )
  }

  return (
    <>
      <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        {t.button}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t.title}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={issue.isPending}>
              {strings.common.cancel}
            </Button>
            <Button onClick={submit} disabled={!vehicleId || !driverId} loading={issue.isPending}>
              {t.submit}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t.body(monthLabel(month))}</p>
          <Select label={t.vehicle} value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} disabled={vehicles.isPending}>
            <option value="">{t.pickVehicle}</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNo}
              </option>
            ))}
          </Select>
          <Select label={t.driver} value={driverId} onChange={(e) => { setDriverId(e.target.value); setProblem(null) }} disabled={!vehicle}>
            <option value="">{t.pickDriver}</option>
            {assigned.map((id) => (
              <option key={id} value={id}>
                {driverNames.get(id)}
              </option>
            ))}
          </Select>
          {options.length === 0 && !vehicles.isPending && <p className="text-sm text-slate-600">{t.noneAvailable}</p>}
          {problem && <NotificationBanner tone="error">{problem}</NotificationBanner>}
        </div>
      </Modal>
    </>
  )
}
