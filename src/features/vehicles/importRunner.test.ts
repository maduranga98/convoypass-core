import { describe, expect, it } from 'vitest'
import type { ImportRowResult, VehicleInput } from '@/lib/api'
import type { CsvRow } from './csv'
import { importInChunks } from './importRunner'

const row = (n: number): CsvRow => ({
  line: n + 1,
  raw: { plateNo: `AB-${1000 + n}`, type: 'Tipper', makeModel: '' },
  value: { plateNo: `AB-${1000 + n}`, type: 'Tipper' },
  error: null,
})
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1))

describe('importInChunks', () => {
  it('sends at most 200 rows per call, in order', async () => {
    const sizes: number[] = []
    const out = await importInChunks(rows(450), async (r) => {
      sizes.push(r.length)
      return r.map((_, i) => ({ row: i + 1, ok: true }))
    })
    expect(sizes).toEqual([200, 200, 50])
    expect(out).toHaveLength(450)
    expect(out.every((o) => o.ok)).toBe(true)
    expect(out.map((o) => o.row.line)).toEqual(rows(450).map((r) => r.line))
  })

  it('maps mixed per-row results back to the right CSV rows', async () => {
    const send = async (r: VehicleInput[]): Promise<ImportRowResult[]> =>
      r.map((_, i) => (i === 1 ? { row: i + 1, ok: false, error: 'plate-exists' } : { row: i + 1, ok: true, vehicleId: `veh_${i}` }))
    const out = await importInChunks(rows(3), send)
    expect(out.map((o) => [o.row.line, o.ok, o.error])).toEqual([
      [2, true, undefined],
      [3, false, 'plate-exists'],
      [4, true, undefined],
    ])
  })

  it('a failing chunk fails only its own rows; later chunks still run', async () => {
    let call = 0
    const out = await importInChunks(
      rows(5),
      async (r) => {
        if (++call === 1) throw new Error('network')
        return r.map((_, i) => ({ row: i + 1, ok: true }))
      },
      { chunkSize: 2, describeError: () => 'Network problem' },
    )
    expect(out.map((o) => [o.ok, o.error])).toEqual([
      [false, 'Network problem'],
      [false, 'Network problem'],
      [true, undefined],
      [true, undefined],
      [true, undefined],
    ])
  })

  it('treats a row missing from the response as failed', async () => {
    const out = await importInChunks(rows(2), async () => [{ row: 1, ok: true }])
    expect(out.map((o) => o.ok)).toEqual([true, false])
  })

  it('reports progress and handles an empty list without calling the server', async () => {
    const progress: number[] = []
    await importInChunks(rows(5), async (r) => r.map((_, i) => ({ row: i + 1, ok: true })), { chunkSize: 2, onProgress: (d) => progress.push(d) })
    expect(progress).toEqual([2, 4, 5])
    let called = false
    expect(await importInChunks([], async () => ((called = true), []))).toEqual([])
    expect(called).toBe(false)
  })
})
