// Mirrors functions/src/reports/types.ts and functions/src/reportsApi.ts (the callables' responses).

export const REPORT_TYPES = ['gate_log', 'contractor_activity', 'turnaround', 'rejections', 'vehicle_history', 'driver_history', 'gate_passes'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const isReportType = (v: unknown): v is ReportType => typeof v === 'string' && (REPORT_TYPES as readonly string[]).includes(v)

/** `datetime`: epoch ms. `date`: `yyyy-MM-dd`. `percent`: a ratio. `minutes`: minutes. */
export type ColumnType = 'text' | 'number' | 'percent' | 'minutes' | 'datetime' | 'date'
export type CellValue = string | number | boolean | null

export interface ReportColumn {
  key: string
  label: string
  type: ColumnType
}

/** `isTotal`: a totals row, pinned last and never sorted. */
export type ReportRow = Record<string, CellValue>

export interface SummaryTile {
  key: string
  label: string
  value: number | string
  type?: 'number' | 'percent' | 'minutes' | 'text'
}

export interface SummarySection {
  key: string
  title: string
  columns: ReportColumn[]
  rows: ReportRow[]
}

export interface ReportResult {
  type: ReportType
  columns: ReportColumn[]
  rows: ReportRow[]
  summary: { tiles: SummaryTile[]; sections: SummarySection[] }
  generatedAt: number
  timezone: string
  from: string
  to: string
}

export interface ReportRequest {
  type: ReportType
  from: string
  to: string
  contractorId?: string
  vehicleId?: string
  driverId?: string
}

export interface TrendDay {
  dateKey: string
  submitted: number
  approved: number
  checkedIn: number
  rejected: number
}

export interface TrendResult {
  days: TrendDay[]
  timezone: string
  generatedAt: number
}
