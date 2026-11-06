import type { CellValue, ReportColumn, ReportResult } from '@/types/reports'

/** `yyyy-MM-dd HH:mm` in an IANA timezone: how every report time is shown and exported. */
export function formatInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** A cell as text, the same way on screen, in CSV and in the print view. */
export function formatCell(value: CellValue | undefined, column: ReportColumn, timeZone: string): string {
  if (value === null || value === undefined || value === '') return ''
  switch (column.type) {
    case 'datetime':
      return typeof value === 'number' ? formatInZone(value, timeZone) : String(value)
    case 'percent':
      return typeof value === 'number' ? `${(Math.round(value * 1000) / 10).toFixed(1)}%` : String(value)
    case 'minutes':
      return typeof value === 'number' ? value.toFixed(1) : String(value)
    default:
      return String(value)
  }
}

/**
 * Spreadsheet formula injection: a text cell starting with `=`, `+`, `-` or `@` (or a tab / carriage return, which
 * Excel also treats as a prefix) gets a single quote in front, so it is shown as text and never evaluated.
 */
export const neutralise = (text: string): string => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)

export const isTotalRow = (row: Record<string, CellValue>): boolean => row.isTotal === true

export const reportFileName = (type: string, from: string, to: string, ext: 'csv' | 'xlsx'): string =>
  `convoypass_${type}_${from}_${to}.${ext}`

/** The `<from>_<to>` of a result, for file names. */
export const fileNameOf = (r: Pick<ReportResult, 'type' | 'from' | 'to'>, ext: 'csv' | 'xlsx'): string =>
  reportFileName(r.type, r.from, r.to, ext)
