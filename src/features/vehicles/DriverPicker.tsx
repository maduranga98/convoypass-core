import { CheckList } from '@/components/ui/CheckList'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import type { Driver, WithId } from '@/types'
import { assignableDrivers } from './assignable'

interface Props {
  /** Every driver the caller can see. Only the active drivers of `contractorId` are offered. */
  drivers: WithId<Driver>[]
  contractorId: string
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  /** Drivers an active penalty blocks right now: they cannot be newly picked (one already picked can still be cleared). */
  blockedIds?: ReadonlySet<string>
  /** driverId -> plate of the vehicle they already drive. Such a driver cannot be picked here until removed from that vehicle. */
  takenBy?: ReadonlyMap<string, string>
}

export function DriverPicker({ drivers, contractorId, value, onChange, disabled, blockedIds, takenBy }: Props) {
  const options = assignableDrivers(drivers, contractorId)
  return (
    <CheckList
      legend={strings.vehicles.form.drivers}
      options={options.map((d) => {
        const blocked = blockedIds?.has(d.id) === true
        const taken = takenBy?.get(d.id)
        const hint = blocked ? strings.penalties.blockedByPenalty : taken ? strings.vehicles.form.driverTaken(taken) : d.phone ? formatPhone(d.phone) : undefined
        const locked = (blocked || taken !== undefined) && !value.includes(d.id)
        return { id: d.id, label: d.name, ...(hint ? { hint } : {}), ...(locked ? { disabled: true } : {}) }
      })}
      value={value}
      onChange={onChange}
      emptyText={contractorId ? strings.vehicles.form.driversEmpty : strings.vehicles.form.driversPickContractor}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  )
}
