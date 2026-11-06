import type { ReportColumn, ReportRow } from '@/types/reports'
import { formatCell, neutralise } from './format'

const BOM = '﻿'

/** RFC 4180: quote fields with a comma, quote or line break; double the quotes. */
const field = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)

/**
 * UTF-8 with a byte order mark (so Excel reads Sinhala and Tamil correctly), CRLF line ends. Text cells are
 * neutralised against formula injection. `rows` are written in the order given (the order on screen).
 */
export function toCsv(columns: readonly ReportColumn[], rows: readonly ReportRow[], timeZone: string): string {
  const header = columns.map((c) => field(neutralise(c.label))).join(',')
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const text = formatCell(row[c.key], c, timeZone)
        return field(c.type === 'text' ? neutralise(text) : text)
      })
      .join(','),
  )
  return `${BOM}${[header, ...body].join('\r\n')}\r\n`
}

export const csvBlob = (csv: string): Blob => new Blob([csv], { type: 'text/csv;charset=utf-8' })
