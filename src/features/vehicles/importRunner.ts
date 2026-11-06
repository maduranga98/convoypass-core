import type { ImportRowError, ImportRowResult, VehicleInput } from '@/lib/api'
import type { CsvRow } from './csv'

/** `importVehicles` accepts at most 200 rows per call. */
export const IMPORT_CHUNK_SIZE = 200

export interface RowOutcome {
  row: CsvRow
  ok: boolean
  /** A server row error code, or the message of a whole-chunk failure. */
  error?: ImportRowError | string
}

/**
 * Sends the valid rows in chunks and maps every per-row result back to its CSV line.
 * A chunk that fails as a whole marks only its own rows as failed; later chunks still run.
 */
export async function importInChunks(
  valid: CsvRow[],
  send: (rows: VehicleInput[]) => Promise<ImportRowResult[]>,
  options: { chunkSize?: number; describeError?: (e: unknown) => string; onProgress?: (done: number, total: number) => void } = {},
): Promise<RowOutcome[]> {
  const size = options.chunkSize ?? IMPORT_CHUNK_SIZE
  const outcomes: RowOutcome[] = []
  for (let start = 0; start < valid.length; start += size) {
    const chunk = valid.slice(start, start + size)
    try {
      const results = await send(chunk.map((r) => r.value as VehicleInput))
      const byRow = new Map(results.map((r) => [r.row, r]))
      chunk.forEach((row, i) => {
        const r = byRow.get(i + 1)
        outcomes.push(r?.ok ? { row, ok: true } : { row, ok: false, error: r?.error ?? 'internal' })
      })
    } catch (e) {
      const message = options.describeError?.(e) ?? 'internal'
      for (const row of chunk) outcomes.push({ row, ok: false, error: message })
    }
    options.onProgress?.(Math.min(start + size, valid.length), valid.length)
  }
  return outcomes
}
