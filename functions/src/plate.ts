// Mirrors src/lib/plate.ts in the web app (functions deploy from this folder only). Keep both copies, and their tests, in sync.

export const PLATE_KEY_MIN = 4
export const PLATE_KEY_MAX = 12

export interface NormalisedPlate {
  /** Display form: uppercase, trimmed, single spaces, tidy hyphens. */
  plateNo: string
  /** Uniqueness key: uppercase alphanumerics only. */
  plateKey: string
}

/** Live-typing form: uppercase, invalid characters stripped, repeated spaces collapsed (no trimming). */
export function formatPlateInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/ {2,}/g, ' ')
}

/** `wp  lj - 4821` -> `{ plateNo: 'WP LJ-4821', plateKey: 'WPLJ4821' }`. Null when 4-12 alphanumerics are not left. */
export function normalisePlate(input: string): NormalisedPlate | null {
  const plateNo = input
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?- ?/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
  const plateKey = plateNo.replace(/[^A-Z0-9]/g, '')
  if (plateKey.length < PLATE_KEY_MIN || plateKey.length > PLATE_KEY_MAX) return null
  return { plateNo, plateKey }
}
