import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { ReportColumn, ReportResult, ReportRow } from '@/types/reports'
import { toCsv } from './csv'
import { fileNameOf, formatCell, formatInZone, neutralise } from './format'
import { buildWorkbook } from './xlsx'

const TZ = 'Asia/Colombo'
const AT = Date.UTC(2026, 2, 10, 18, 25) // 2026-03-10 23:55 in Colombo

const columns: ReportColumn[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'time', label: 'Time', type: 'datetime' },
  { key: 'count', label: 'Count', type: 'number' },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'day', label: 'Day', type: 'date' },
]

const result = (rows: ReportRow[]): ReportResult => ({
  type: 'rejections',
  columns,
  rows,
  summary: {
    tiles: [{ key: 'n', label: 'Rejections', value: 3 }, { key: 'r', label: 'Rate', value: 0.25, type: 'percent' }],
    sections: [{ key: 's', title: 'By reason', columns: [{ key: 'name', label: 'Reason', type: 'text' }, { key: 'count', label: 'Rejections', type: 'number' }], rows: [{ name: 'GPS unclear', count: 2 }] }],
  },
  generatedAt: AT,
  timezone: TZ,
  from: '2026-03-10',
  to: '2026-03-10',
})

describe('csv', () => {
  const csv = (rows: ReportRow[]) => toCsv(columns, rows, TZ)

  it('starts with a byte order mark and ends lines with CRLF', () => {
    const out = csv([{ name: 'a', time: AT, count: 1, rate: 0.5, day: '2026-03-10' }])
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(out.split('\r\n')).toEqual(['﻿Name,Time,Count,Rate,Day', 'a,2026-03-10 23:55,1,50.0%,2026-03-10', ''])
  })
  it('escapes commas, quotes and newlines', () => {
    const out = csv([{ name: 'Smith, "Bob"\nJr', time: null, count: null, rate: null, day: null }])
    expect(out).toContain('"Smith, ""Bob""\nJr",,,,\r\n')
  })
  it('keeps Sinhala and Tamil text as it is', () => {
    const out = csv([{ name: 'නිමල් පෙරේරා', time: null, count: 2, rate: null, day: null }, { name: 'குமார்', time: null, count: 1, rate: null, day: null }])
    expect(out).toContain('නිමල් පෙරේරා')
    expect(out).toContain('குமார்')
    const bytes = new TextEncoder().encode(out)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(out)
  })
  it('neutralises =, +, - and @ prefixes in text cells and headers', () => {
    for (const bad of ['=SUM(A1)', '+1', '-2+3', '@cmd', '\t=x']) {
      expect(csv([{ name: bad, time: null, count: null, rate: null, day: null }])).toContain(`'${bad}`)
    }
    expect(neutralise('safe')).toBe('safe')
    expect(neutralise("'=x")).toBe("'=x")
    expect(toCsv([{ key: 'a', label: '=HYPERLINK("x")', type: 'text' }], [], TZ)).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('does not touch numbers', () => {
    expect(csv([{ name: 'x', time: null, count: 5, rate: null, day: null }])).toContain('x,,5,,')
  })
})

describe('format', () => {
  it('shows times in the tenant timezone as yyyy-MM-dd HH:mm', () => {
    expect(formatInZone(AT, TZ)).toBe('2026-03-10 23:55')
    expect(formatInZone(AT, 'UTC')).toBe('2026-03-10 18:25')
    expect(formatCell(0.125, { key: 'r', label: 'r', type: 'percent' }, TZ)).toBe('12.5%')
    expect(formatCell(12.34, { key: 'm', label: 'm', type: 'minutes' }, TZ)).toBe('12.3')
  })
  it('names files convoypass_<report>_<from>_<to>.<ext>', () => {
    expect(fileNameOf(result([]), 'xlsx')).toBe('convoypass_rejections_2026-03-10_2026-03-10.xlsx')
  })
})

describe('xlsx', () => {
  it('opens with a Summary and a Data sheet, a bold frozen header and real date cells', async () => {
    const rows: ReportRow[] = [
      { name: '=1+1', time: AT, count: 4, rate: 0.25, day: '2026-03-10' },
      { name: 'නිමල්', time: null, count: 1, rate: null, day: null },
      { name: 'Total', time: null, count: 5, rate: 0.2, day: null, isTotal: true },
    ]
    const wb = await buildWorkbook(result(rows), rows, { title: 'Rejections', filters: ['Contractor: Alpha'] })
    const buffer = await wb.xlsx.writeBuffer()

    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buffer)
    expect(back.worksheets.map((s) => s.name)).toEqual(['Summary', 'Data'])

    const data = back.getWorksheet('Data')
    expect(data?.getRow(1).values).toEqual([undefined, 'Name', 'Time', 'Count', 'Rate', 'Day'])
    expect(data?.getRow(1).font?.bold).toBe(true)
    expect(data?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(data?.getCell('A2').value).toBe("'=1+1")
    expect(data?.getCell('A3').value).toBe('නිමල්')
    const time = data?.getCell('B2').value
    expect(time).toBeInstanceOf(Date)
    expect((time as Date).toISOString()).toBe('2026-03-10T23:55:00.000Z') // wall-clock time of the tenant
    expect(data?.getCell('B2').numFmt).toBe('yyyy-mm-dd hh:mm')
    expect(data?.getCell('C2').value).toBe(4)
    expect(data?.getCell('D2').numFmt).toBe('0.0%')
    expect(data?.getCell('E2').value).toBeInstanceOf(Date)
    expect(data?.getColumn(1).width).toBeGreaterThan(5)
    expect(data?.getRow(4).font?.bold).toBe(true)

    const summary = back.getWorksheet('Summary')
    const text = (summary?.getSheetValues() ?? []).flat().filter((v) => typeof v === 'string')
    expect(text).toEqual(expect.arrayContaining(['Report', 'Rejections', 'Range', '2026-03-10', 'Filters', 'Contractor: Alpha', 'Generated', '2026-03-10 23:55', 'Key figures', 'By reason', 'GPS unclear']))
  })
})
