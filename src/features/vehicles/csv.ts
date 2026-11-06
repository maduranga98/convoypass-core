import Papa from 'papaparse'
import { normalisePlate } from '@/lib/plate'
import { strings } from '@/lib/strings'
import { VEHICLE_TYPES } from '@/lib/vehicleTypes'
import { vehicleFieldsSchemaFor } from './schemas'

export const MAX_CSV_ROWS = 2000

export interface CsvVehicle {
  plateNo: string
  type: string
  makeModel?: string
}

export interface CsvRow {
  /** Spreadsheet line number (the header is line 1). */
  line: number
  raw: { plateNo: string; type: string; makeModel: string }
  /** Present only when the row is valid. */
  value: CsvVehicle | null
  error: string | null
}

export type CsvParseResult =
  | { ok: true; rows: CsvRow[]; truncated: boolean }
  | { ok: false; reason: 'header' | 'empty' }

const canonicalType = (raw: string, allowed: readonly string[]): string => {
  const t = raw.trim().toLowerCase()
  return allowed.find((v) => v.toLowerCase() === t) ?? raw.trim()
}

const stripBom = (t: string): string => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t)

/** Parses and validates a vehicle CSV (`plateNo,type,makeModel`) with the same schema the form uses, against the tenant's types. */
export function parseVehicleCsv(text: string, allowedTypes: readonly string[] = VEHICLE_TYPES): CsvParseResult {
  const schema = vehicleFieldsSchemaFor(allowedTypes)
  const parsed = Papa.parse<Record<string, string | undefined>>(stripBom(text), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s_-]/g, ''),
  })
  const fields = parsed.meta.fields ?? []
  if (!fields.includes('plateno') || !fields.includes('type')) return { ok: false, reason: 'header' }
  if (parsed.data.length === 0) return { ok: false, reason: 'empty' }

  const truncated = parsed.data.length > MAX_CSV_ROWS
  const seen = new Set<string>()
  const rows = parsed.data.slice(0, MAX_CSV_ROWS).map((r, i): CsvRow => {
    const raw = { plateNo: r.plateno ?? '', type: r.type ?? '', makeModel: r.makemodel ?? '' }
    const result = schema.safeParse({ ...raw, type: canonicalType(raw.type, allowedTypes) })
    if (!result.success) {
      return { line: i + 2, raw, value: null, error: result.error.issues[0]?.message ?? strings.vehicles.errors.plate }
    }
    const plate = normalisePlate(result.data.plateNo)
    if (!plate) return { line: i + 2, raw, value: null, error: strings.vehicles.errors.plate }
    if (seen.has(plate.plateKey)) {
      return { line: i + 2, raw, value: null, error: strings.vehicles.errors.duplicateInFile }
    }
    seen.add(plate.plateKey)
    const { type, makeModel } = result.data
    return { line: i + 2, raw, value: { plateNo: plate.plateNo, type, ...(makeModel ? { makeModel } : {}) }, error: null }
  })
  return { ok: true, rows, truncated }
}

/** CSV text; cells that could be read as spreadsheet formulas are escaped. */
export const toCsv = (rows: Record<string, string>[], columns: string[]): string =>
  Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? '')) }, { escapeFormulae: true })

export const TEMPLATE_CSV = toCsv(
  [
    { plateNo: 'WP LJ-4821', type: 'Bulk Tanker', makeModel: 'Tata Prima 4028' },
    { plateNo: 'CAB-1234', type: 'Tipper', makeModel: '' },
  ],
  ['plateNo', 'type', 'makeModel'],
)

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
