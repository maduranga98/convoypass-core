import { describe, expect, it } from 'vitest'
import { parseVehicleCsv, toCsv } from './csv'
import { vehicleFieldsSchema } from './schemas'

const ok = (text: string) => {
  const r = parseVehicleCsv(text)
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`)
  return r.rows
}

describe('vehicleFieldsSchema', () => {
  it('accepts a good row and rejects bad plate / type / long make', () => {
    expect(vehicleFieldsSchema.safeParse({ plateNo: 'WP LJ-4821', type: 'Tipper', makeModel: '' }).success).toBe(true)
    expect(vehicleFieldsSchema.safeParse({ plateNo: 'A1', type: 'Tipper', makeModel: '' }).success).toBe(false)
    expect(vehicleFieldsSchema.safeParse({ plateNo: 'CAB-1234', type: 'Spaceship', makeModel: '' }).success).toBe(false)
    expect(vehicleFieldsSchema.safeParse({ plateNo: 'CAB-1234', type: 'Tipper', makeModel: 'x'.repeat(61) }).success).toBe(false)
  })
})

describe('parseVehicleCsv', () => {
  it('validates each row and reports the line number', () => {
    const rows = ok(
      ['plateNo,type,makeModel', 'wp lj-4821,bulk tanker,Tata', 'A1,Tipper,', 'CAB-1234,Spaceship,', 'NP KA 1234,Lorry,'].join('\n'),
    )
    expect(rows.map((r) => [r.line, r.value !== null])).toEqual([
      [2, true],
      [3, false],
      [4, false],
      [5, true],
    ])
    expect(rows[0]?.value).toEqual({ plateNo: 'WP LJ-4821', type: 'Bulk Tanker', makeModel: 'Tata' })
    expect(rows[1]?.error).toBeTruthy()
    expect(rows[3]?.value).toEqual({ plateNo: 'NP KA 1234', type: 'Lorry' })
  })

  it('flags a plate repeated in the file, whatever its spacing', () => {
    const rows = ok('plateNo,type\nWP LJ-4821,Tipper\nwplj4821,Tipper')
    expect(rows[0]?.value).not.toBeNull()
    expect(rows[1]?.value).toBeNull()
  })

  it('tolerates header case, a BOM, blank lines and CRLF', () => {
    const rows = ok('﻿Plate No, TYPE ,Make_Model\r\n\r\nCAB-1234,Flatbed,Isuzu\r\n\r\n')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toEqual({ plateNo: 'CAB-1234', type: 'Flatbed', makeModel: 'Isuzu' })
  })

  it('rejects a file without the required columns or rows', () => {
    expect(parseVehicleCsv('plate,kind\nA,B')).toEqual({ ok: false, reason: 'header' })
    expect(parseVehicleCsv('plateNo,type\n')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('toCsv', () => {
  it('escapes spreadsheet formulas', () => {
    expect(toCsv([{ a: '=1+1' }], ['a'])).toContain("'=1+1")
  })
})

describe('parseVehicleCsv with the tenant type list', () => {
  const csv = 'plateNo,type,makeModel\nCAB-1234,water bowser,\nCAB-5678,Tipper,\n'

  it('accepts a custom type (any case) and refuses a default that the tenant removed', () => {
    const parsed = parseVehicleCsv(csv, ['Water Bowser'])
    if (!parsed.ok) throw new Error('expected rows')
    expect(parsed.rows[0]?.value?.type).toBe('Water Bowser')
    expect(parsed.rows[1]?.error).toBeTruthy()
  })
})
