import { plateSearchKey } from '@/lib/plate'

export const MIN_SEARCH = 2
export const MAX_MATCHES = 8

/**
 * Vehicles whose plateKey contains the typed text (normalised like a plate), best first: an exact plate, then one
 * ending with it (the guard typed the last digits), then one starting with it, then anywhere. At most `max`.
 */
export function searchPlates<T extends { plateKey: string }>(vehicles: readonly T[], query: string, max = MAX_MATCHES): T[] {
  const key = plateSearchKey(query)
  if (key.length < MIN_SEARCH) return []
  const rank = (plateKey: string): number =>
    plateKey === key ? 0 : plateKey.endsWith(key) ? 1 : plateKey.startsWith(key) ? 2 : 3
  return vehicles
    .filter((v) => v.plateKey.includes(key))
    .map((v) => ({ v, r: rank(v.plateKey) }))
    .sort((a, b) => a.r - b.r || a.v.plateKey.localeCompare(b.v.plateKey))
    .slice(0, max)
    .map((x) => x.v)
}
