import type ExcelJS from 'exceljs'
import { strings } from '@/lib/strings'
import type { CellValue, ReportColumn, ReportResult, ReportRow } from '@/types/reports'
import { formatCell, formatInZone, isTotalRow, neutralise } from './format'

const t = strings.reports.xlsx

export interface XlsxMeta {
  title: string
  /** Human readable filter lines, e.g. `Contractor: Alpha`. */
  filters: string[]
}

const DATE_TIME = 'yyyy-mm-dd hh:mm'
const WIDTH_MIN = 8
const WIDTH_MAX = 60

/** A real date cell showing the tenant's wall-clock time: the wall time is stored as if it were UTC. */
function wallDate(ms: number, timeZone: string): Date {
  const [d = '', h = '00:00'] = formatInZone(ms, timeZone).split(' ')
  const [y = 1970, m = 1, day = 1] = d.split('-').map(Number)
  const [hh = 0, mm = 0] = h.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, day, hh, mm))
}

function dayDate(value: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : value
}

function cellOf(value: CellValue | undefined, column: ReportColumn, timeZone: string): ExcelJS.CellValue {
  if (value === null || value === undefined || value === '') return null
  switch (column.type) {
    case 'datetime':
      return typeof value === 'number' ? wallDate(value, timeZone) : String(value)
    case 'date':
      return typeof value === 'string' ? dayDate(value) : String(value)
    case 'number':
    case 'percent':
    case 'minutes':
      return typeof value === 'number' ? value : String(value)
    default:
      return neutralise(String(value))
  }
}

const numFmt = (type: ReportColumn['type']): string | undefined =>
  type === 'datetime' ? DATE_TIME : type === 'date' ? 'yyyy-mm-dd' : type === 'percent' ? '0.0%' : type === 'minutes' ? '0.0' : undefined

function writeTable(sheet: ExcelJS.Worksheet, columns: readonly ReportColumn[], rows: readonly ReportRow[], timeZone: string, startRow: number): void {
  const header = sheet.getRow(startRow)
  columns.forEach((c, i) => {
    header.getCell(i + 1).value = neutralise(c.label)
  })
  header.font = { bold: true }
  header.alignment = { vertical: 'middle', wrapText: true }
  rows.forEach((row, r) => {
    const out = sheet.getRow(startRow + 1 + r)
    columns.forEach((c, i) => {
      const cell = out.getCell(i + 1)
      cell.value = cellOf(row[c.key], c, timeZone)
      const fmt = numFmt(c.type)
      if (fmt) cell.numFmt = fmt
    })
    if (isTotalRow(row)) out.font = { bold: true }
  })
  columns.forEach((c, i) => {
    const longest = Math.max(
      c.label.length,
      ...rows.map((row) => formatCell(row[c.key], c, timeZone).length),
    )
    const col = sheet.getColumn(i + 1)
    col.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, longest + 2))
  })
}

/**
 * Two sheets: "Summary" (report, range, filters, generated time, key figures and the breakdown tables) and "Data"
 * (what is on screen, in screen order). `exceljs` is imported on demand: it is large and only exports need it.
 */
export async function buildWorkbook(result: ReportResult, rows: readonly ReportRow[], meta: XlsxMeta): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs')
  const wb = new Excel.Workbook()
  wb.creator = 'ConvoyPass'
  const tz = result.timezone

  const summary = wb.addWorksheet(strings.reports.summary)
  const lines: [string, string | number][] = [
    [t.report, meta.title],
    [t.range, strings.reports.range(result.from, result.to)],
    [t.filters, meta.filters.length > 0 ? meta.filters.join('; ') : t.none],
    [t.generated, formatInZone(result.generatedAt, tz)],
    [t.timezone, tz],
  ]
  lines.forEach(([label, value], i) => {
    const row = summary.getRow(i + 1)
    row.getCell(1).value = neutralise(label)
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = typeof value === 'string' ? neutralise(value) : value
  })
  let at = lines.length + 2
  summary.getRow(at).getCell(1).value = t.keyFigures
  summary.getRow(at).getCell(1).font = { bold: true }
  at++
  for (const tile of result.summary.tiles) {
    summary.getRow(at).getCell(1).value = neutralise(tile.label)
    const cell = summary.getRow(at).getCell(2)
    cell.value = typeof tile.value === 'number' ? tile.value : neutralise(String(tile.value))
    if (typeof tile.value === 'number' && tile.type === 'percent') cell.numFmt = '0.0%'
    cell.alignment = { horizontal: 'left' }
    at++
  }
  for (const section of result.summary.sections) {
    at++
    summary.getRow(at).getCell(1).value = neutralise(section.title)
    summary.getRow(at).getCell(1).font = { bold: true }
    at++
    writeTable(summary, section.columns, section.rows, tz, at)
    at += section.rows.length + 1
  }
  summary.getColumn(1).width = 34
  summary.getColumn(2).width = 40
  for (let c = 3; c <= 8; c++) summary.getColumn(c).width = 18

  const data = wb.addWorksheet(strings.reports.data, { views: [{ state: 'frozen', ySplit: 1 }] })
  writeTable(data, result.columns, rows, tz, 1)
  return wb
}

export async function xlsxBlob(result: ReportResult, rows: readonly ReportRow[], meta: XlsxMeta): Promise<Blob> {
  const wb = await buildWorkbook(result, rows, meta)
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
