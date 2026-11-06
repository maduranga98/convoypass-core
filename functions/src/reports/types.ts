import type { CheckInStamp, GateEventData, HistoryEntry, PassStatus, Rejection } from '../types.js'

export const REPORT_TYPES = [
  'gate_log',
  'contractor_activity',
  'turnaround',
  'rejections',
  'vehicle_history',
  'driver_history',
  'gate_passes',
] as const
export type ReportType = (typeof REPORT_TYPES)[number]

/**
 * A pass as the reports see it: only what they need. Evidence, checklist answers and capture metadata are never
 * loaded, so a photo path or URL cannot end up in a report or an export.
 */
export interface ReportPass {
  id: string
  contractorId: string
  vehicleId: string
  plateNo: string
  vehicleType: string
  dateKey: string
  driverId: string
  driverName: string
  status: PassStatus
  attempt: number
  /** Milliseconds; the latest attempt's submit time. */
  submittedAt: number | null
  supervisor?: { uid: string; name: string; at: number }
  officer?: { uid: string; name: string; at: number }
  rejection?: Rejection
  rejectionHistory?: (Rejection & { attempt: number })[]
  history?: HistoryEntry[]
  checkIn?: CheckInStamp
}

export type ReportEvent = GateEventData & { id: string }

/** One gate visit (one in, and its out) as the gate pass report sees it. Times are milliseconds. */
export interface ReportVisit {
  id: string
  /** The daily pass it belongs to; absent on visits that predate multiple entries per day. */
  passId?: string
  vehicleId: string
  /** `YYYYMMDD` of the check-in. */
  dateKey: string
  checkInAt: number
  checkOutAt: number | null
}

export type CellValue = string | number | boolean | null

/**
 * `datetime`: epoch milliseconds, shown in the tenant timezone. `date`: `yyyy-MM-dd`. `percent`: a ratio (0.25 = 25%).
 * `minutes`: minutes with one decimal.
 */
export type ColumnType = 'text' | 'number' | 'percent' | 'minutes' | 'datetime' | 'date'

export interface ReportColumn {
  key: string
  label: string
  type: ColumnType
}

/** `isTotal` marks a totals row: pinned last, never sorted. */
export type ReportRow = Record<string, CellValue> & { isTotal?: boolean }

export interface SummaryTile {
  key: string
  label: string
  value: number | string
  type?: 'number' | 'percent' | 'minutes' | 'text'
}

/** A breakdown table in the summary: also the table alternative of a chart. */
export interface SummarySection {
  key: string
  title: string
  columns: ReportColumn[]
  rows: ReportRow[]
}

export interface ReportSummary {
  tiles: SummaryTile[]
  sections: SummarySection[]
}

export interface ReportResult {
  type: ReportType
  columns: ReportColumn[]
  rows: ReportRow[]
  summary: ReportSummary
  /** Milliseconds. */
  generatedAt: number
  timezone: string
  from: string
  to: string
}

export interface ReportFilters {
  contractorId?: string
  vehicleId?: string
  driverId?: string
}

/** Everything a report needs, already loaded. */
export interface ReportInput {
  type: ReportType
  passes: readonly ReportPass[]
  events: readonly ReportEvent[]
  /** Gate visits of the range (only the gate pass report reads them). */
  visits: readonly ReportVisit[]
  /** The gate time in hours (the company's dwell limit, default 16): a pass's entries end this long after its first check-in. */
  gateTimeHours: number
  contractorNames: ReadonlyMap<string, string>
  /** Rejection reason code -> label (the tenant's list, or the defaults). */
  reasonLabels: ReadonlyMap<string, string>
  timezone: string
  from: string
  to: string
  generatedAt: number
  filters: ReportFilters
}

export const STATUS_LABELS: Record<PassStatus, string> = {
  submitted: 'Waiting supervisor',
  supervisor_approved: 'Waiting officer',
  officer_approved: 'Approved (awaiting entry)',
  checked_in: 'Checked in',
  rejected: 'Rejected',
}

export const STAGE_LABELS = { supervisor: 'Supervisor', officer: 'Officer', revoked: 'Revoked' } as const

export const contractorName = (names: ReadonlyMap<string, string>, id: string): string => names.get(id) ?? id
