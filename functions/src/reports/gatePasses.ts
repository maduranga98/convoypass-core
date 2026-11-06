import { byText } from './stats.js'
import { contractorName, STATUS_LABELS, type ReportColumn, type ReportInput, type ReportPass, type ReportResult, type ReportRow, type ReportVisit } from './types.js'

const HOUR_MS = 3_600_000

const COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'plate', label: 'Plate', type: 'text' },
  { key: 'vehicleType', label: 'Vehicle type', type: 'text' },
  { key: 'contractor', label: 'Contractor', type: 'text' },
  { key: 'driver', label: 'Driver', type: 'text' },
  { key: 'status', label: 'Pass status', type: 'text' },
  { key: 'submitted', label: 'Submitted', type: 'datetime' },
  { key: 'supervisor', label: 'Supervisor', type: 'text' },
  { key: 'supervisorAt', label: 'Supervisor time', type: 'datetime' },
  { key: 'officer', label: 'Officer', type: 'text' },
  { key: 'officerAt', label: 'Officer time', type: 'datetime' },
  { key: 'firstIn', label: 'First check-in', type: 'datetime' },
  { key: 'endsAt', label: 'Gate time ends', type: 'datetime' },
  { key: 'entries', label: 'Entries', type: 'number' },
  { key: 'lastOut', label: 'Last check-out', type: 'datetime' },
  { key: 'onSiteMinutes', label: 'Time inside (min)', type: 'minutes' },
  { key: 'gate', label: 'At the gate', type: 'text' },
]

const dateText = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

/** The visits of a pass: by `passId`, else (visits that predate it) by vehicle and check-in day. */
function visitsOf(pass: ReportPass, visits: readonly ReportVisit[]): ReportVisit[] {
  return visits.filter((v) => (v.passId ? v.passId === pass.id : v.vehicleId === pass.vehicleId && v.dateKey === pass.dateKey)).sort((a, b) => a.checkInAt - b.checkInAt)
}

/**
 * One row per pass of the range: who approved it and when, when the vehicle first came in, when its gate time ends (first
 * check-in + the company's gate time), how many times it entered, when it last left and the time it spent inside. Open
 * visits count up to the moment the report was generated.
 */
export function buildGatePasses(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const { contractorNames, generatedAt, gateTimeHours } = input
  let approved = 0
  let entered = 0
  let rejected = 0
  let entries = 0
  let inside = 0
  const rows: (ReportRow & { _id: string })[] = []

  for (const p of input.passes) {
    const mine = visitsOf(p, input.visits)
    const firstIn = p.checkIn?.at ?? mine[0]?.checkInAt ?? null
    const open = mine.some((v) => v.checkOutAt === null)
    const lastOut = mine.reduce<number | null>((acc, v) => (v.checkOutAt !== null && (acc === null || v.checkOutAt > acc) ? v.checkOutAt : acc), null)
    const minutes = mine.reduce((sum, v) => sum + ((v.checkOutAt ?? generatedAt) - v.checkInAt) / 60_000, 0)
    if (p.status === 'officer_approved' || p.status === 'checked_in') approved++
    if (p.status === 'rejected') rejected++
    if (firstIn !== null) entered++
    entries += mine.length
    if (open) inside++
    rows.push({
      _id: p.id,
      date: dateText(p.dateKey),
      plate: p.plateNo,
      vehicleType: p.vehicleType,
      contractor: contractorName(contractorNames, p.contractorId),
      driver: p.driverName,
      status: STATUS_LABELS[p.status],
      submitted: p.submittedAt,
      supervisor: p.supervisor?.name ?? '',
      supervisorAt: p.supervisor?.at ?? null,
      officer: p.officer?.name ?? '',
      officerAt: p.officer?.at ?? null,
      firstIn,
      endsAt: firstIn === null ? null : firstIn + gateTimeHours * HOUR_MS,
      entries: mine.length,
      lastOut,
      onSiteMinutes: mine.length === 0 ? null : Math.round(minutes * 10) / 10,
      gate: firstIn === null ? 'Not entered' : open ? 'Inside' : 'Outside',
    })
  }

  rows.sort((a, b) => byText(String(a.date), String(b.date)) || byText(String(a.plate), String(b.plate)) || byText(a._id, b._id))

  return {
    columns: COLUMNS,
    rows: rows.map(({ _id, ...row }) => {
      void _id
      return row
    }),
    summary: {
      tiles: [
        { key: 'passes', label: 'Gate passes', value: input.passes.length },
        { key: 'approved', label: 'Approved', value: approved },
        { key: 'entered', label: 'Entered', value: entered },
        { key: 'entries', label: 'Total entries', value: entries },
        { key: 'inside', label: 'Inside now', value: inside },
        { key: 'rejected', label: 'Rejected', value: rejected },
      ],
      sections: [],
    },
  }
}
