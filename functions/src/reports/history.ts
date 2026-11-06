import { rejectionEvents, stageTimes } from './passFacts.js'
import { byText } from './stats.js'
import { fromDateKey } from './range.js'
import { STATUS_LABELS, type ReportColumn, type ReportInput, type ReportResult, type ReportRow } from './types.js'

const common = (second: ReportColumn): ReportColumn[] => [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'plate', label: 'Plate', type: 'text' },
  second,
  { key: 'status', label: 'Final status', type: 'text' },
  { key: 'attempts', label: 'Attempts', type: 'number' },
  { key: 'submitted', label: 'Submitted', type: 'datetime' },
  { key: 'supervisor', label: 'Supervisor', type: 'text' },
  { key: 'supervisorAt', label: 'Supervisor time', type: 'datetime' },
  { key: 'officer', label: 'Officer', type: 'text' },
  { key: 'officerAt', label: 'Officer time', type: 'datetime' },
  { key: 'gate', label: 'Check-in gate', type: 'text' },
  { key: 'checkInAt', label: 'Check-in time', type: 'datetime' },
  { key: 'rejections', label: 'Rejection reasons', type: 'text' },
]

/** One row per pass in range, oldest day first. `vehicle_history` names the driver, `driver_history` the vehicle type. */
export function buildHistory(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const forVehicle = input.type === 'vehicle_history'
  const labelOf = (code: string): string => input.reasonLabels.get(code) ?? code
  const passes = [...input.passes].sort((a, b) => byText(a.dateKey, b.dateKey) || byText(a.plateNo, b.plateNo) || byText(a.id, b.id))

  let checkedIn = 0
  let rejected = 0
  let attempts = 0
  const rows = passes.map((p): ReportRow => {
    const t = stageTimes(p)
    if (p.status === 'checked_in') checkedIn++
    if (p.status === 'rejected') rejected++
    attempts += p.attempt
    const reasons = rejectionEvents(p)
      .sort((a, b) => a.at - b.at)
      .map((e) => (e.note ? `${labelOf(e.reasonCode)}: ${e.note}` : labelOf(e.reasonCode)))
    return {
      date: fromDateKey(p.dateKey),
      plate: p.plateNo,
      [forVehicle ? 'driver' : 'vehicleType']: forVehicle ? p.driverName : p.vehicleType,
      status: STATUS_LABELS[p.status],
      attempts: p.attempt,
      submitted: t.submitted,
      supervisor: p.supervisor?.name ?? '',
      supervisorAt: t.supervisor,
      officer: p.officer?.name ?? '',
      officerAt: t.officer,
      gate: p.checkIn?.gateName ?? '',
      checkInAt: t.checkIn,
      rejections: reasons.join('; '),
    }
  })

  return {
    columns: common(forVehicle ? { key: 'driver', label: 'Driver', type: 'text' } : { key: 'vehicleType', label: 'Vehicle type', type: 'text' }),
    rows,
    summary: {
      tiles: [
        { key: 'passes', label: 'Passes', value: passes.length },
        { key: 'attempts', label: 'Submissions', value: attempts },
        { key: 'checkedIn', label: 'Checked in', value: checkedIn },
        { key: 'rejected', label: 'Currently rejected', value: rejected },
      ],
      sections: [],
    },
  }
}
