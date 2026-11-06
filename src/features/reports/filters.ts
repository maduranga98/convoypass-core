import { isReportType, type ReportRequest, type ReportType } from '@/types/reports'
import { addDays, inclusiveDays, isDay, MAX_RANGE_DAYS } from './days'

export const PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'custom'] as const
export type Preset = (typeof PRESETS)[number]
const isPreset = (v: string | null): v is Preset => v !== null && (PRESETS as readonly string[]).includes(v)

export interface ReportFilters {
  type: ReportType
  preset: Preset
  from: string
  to: string
  contractorId: string
  vehicleId: string
  driverId: string
}

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) }
    case 'last7':
      return { from: addDays(today, -6), to: today }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

/**
 * The applied filters live in the URL (`type`, `preset`, `from`, `to`, `contractor`, `vehicle`, `driver`), so a
 * report view is linkable and survives a refresh. Explicit dates win over a preset; with neither, the range is today.
 * `null` when there is no (valid) report type: the page then shows the picker.
 */
export function parseFilters(params: URLSearchParams, today: string): ReportFilters | null {
  const type = params.get('type')
  if (!isReportType(type)) return null
  const presetParam = params.get('preset')
  const from = params.get('from')
  const to = params.get('to')
  let preset: Preset = isPreset(presetParam) ? presetParam : 'today'
  let range: { from: string; to: string }
  if (isDay(from) && isDay(to)) {
    range = { from, to }
    if (!isPreset(presetParam)) preset = 'custom'
  } else {
    range = presetRange(preset === 'custom' ? 'today' : preset, today)
  }
  return {
    type,
    preset,
    ...range,
    contractorId: params.get('contractor') ?? '',
    vehicleId: params.get('vehicle') ?? '',
    driverId: params.get('driver') ?? '',
  }
}

/** Only what matters for the report goes in the URL. */
export function toParams(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams({ type: f.type, preset: f.preset, from: f.from, to: f.to })
  if (f.contractorId) p.set('contractor', f.contractorId)
  if (f.type === 'vehicle_history' && f.vehicleId) p.set('vehicle', f.vehicleId)
  if (f.type === 'driver_history' && f.driverId) p.set('driver', f.driverId)
  return p
}

export type FilterProblem = 'range-order' | 'range-long' | 'need-vehicle' | 'need-driver'

export function filterProblem(f: ReportFilters): FilterProblem | null {
  if (!isDay(f.from) || !isDay(f.to) || f.from > f.to) return 'range-order'
  if (inclusiveDays(f.from, f.to) > MAX_RANGE_DAYS) return 'range-long'
  if (f.type === 'vehicle_history' && !f.vehicleId) return 'need-vehicle'
  if (f.type === 'driver_history' && !f.driverId) return 'need-driver'
  return null
}

export function toRequest(f: ReportFilters): ReportRequest {
  return {
    type: f.type,
    from: f.from,
    to: f.to,
    ...(f.contractorId ? { contractorId: f.contractorId } : {}),
    ...(f.type === 'vehicle_history' && f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.type === 'driver_history' && f.driverId ? { driverId: f.driverId } : {}),
  }
}

/** A link to a vehicle's history for the last 30 days. `today` is a `YYYY-MM-DD` day or a `YYYYMMDD` dateKey. */
export function vehicleHistoryLink(scope: 'admin' | 'officer', vehicleId: string, today: string): string {
  const day = today.includes('-') ? today : `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`
  const { from, to } = presetRange('last30', day)
  return `/${scope}/reports?${toParams({ type: 'vehicle_history', preset: 'last30', from, to, contractorId: '', vehicleId, driverId: '' })}`
}
