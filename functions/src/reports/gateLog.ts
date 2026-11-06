import { DENY_REASONS } from '../denyReasons.js'
import { formatLocal } from './range.js'
import { byText } from './stats.js'
import { contractorName, type ReportColumn, type ReportInput, type ReportResult, type ReportRow } from './types.js'

const COLUMNS: ReportColumn[] = [
  { key: 'time', label: 'Time', type: 'datetime' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'plate', label: 'Plate', type: 'text' },
  { key: 'vehicleType', label: 'Vehicle type', type: 'text' },
  { key: 'contractor', label: 'Contractor', type: 'text' },
  { key: 'driver', label: 'Driver', type: 'text' },
  { key: 'gate', label: 'Gate', type: 'text' },
  { key: 'guard', label: 'Guard', type: 'text' },
  { key: 'note', label: 'Reason / note', type: 'text' },
  { key: 'offline', label: 'Offline', type: 'text' },
]

const denyLabel = (code: string): string => DENY_REASONS.find((r) => r.id === code)?.label ?? code

/**
 * Check-ins (passes whose `checkIn.at` is in range) and denials (`gateEvents`), merged oldest first. The caller has
 * already limited both lists to the range. An offline check-in shows the device time, labelled unverified.
 */
export function buildGateLog(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const { timezone, contractorNames } = input
  const vehicles = new Set<string>()
  const rows: (ReportRow & { _id: string })[] = []
  let checkIns = 0
  let denials = 0

  for (const p of input.passes) {
    if (!p.checkIn) continue
    checkIns++
    vehicles.add(p.vehicleId)
    const device = p.checkIn.offlineCapturedAt ? Date.parse(p.checkIn.offlineCapturedAt) : NaN
    rows.push({
      _id: `c_${p.id}`,
      time: p.checkIn.at,
      type: 'Check-in',
      plate: p.plateNo,
      vehicleType: p.vehicleType,
      contractor: contractorName(contractorNames, p.contractorId),
      driver: p.driverName,
      gate: p.checkIn.gateName,
      guard: p.checkIn.name,
      note: '',
      offline: p.checkIn.offlineCapturedAt
        ? Number.isNaN(device)
          ? 'Offline'
          : `Offline · device ${formatLocal(timezone, device)} (unverified)`
        : '',
    })
  }
  for (const e of input.events) {
    denials++
    vehicles.add(e.vehicleId)
    const reason = denyLabel(e.reasonCode)
    rows.push({
      _id: `d_${e.id}`,
      time: e.at,
      type: 'Denied',
      plate: e.plateNo,
      vehicleType: '',
      contractor: contractorName(contractorNames, e.contractorId),
      driver: e.driverName ?? '',
      gate: e.gateName,
      guard: e.byName,
      note: e.note ? `${reason}: ${e.note}` : reason,
      offline: '',
    })
  }

  rows.sort((a, b) => (a.time as number) - (b.time as number) || byText(String(a.type), String(b.type)) || byText(a._id, b._id))

  return {
    columns: COLUMNS,
    rows: rows.map(({ _id, ...row }) => {
      void _id
      return row
    }),
    summary: {
      tiles: [
        { key: 'checkIns', label: 'Check-ins', value: checkIns },
        { key: 'denials', label: 'Denied entries', value: denials },
        { key: 'vehicles', label: 'Unique vehicles', value: vehicles.size },
      ],
      sections: [],
    },
  }
}

